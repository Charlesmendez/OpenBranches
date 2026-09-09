import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Snapshot } from '../../src/domain/types';
import { teamId, pairingStartSchema } from '../../src/team/protocol';
import {
  companionResponse,
  deviceSecret,
  localPreviewRequest,
  pairedIdentity,
  type Companion,
  type SharingPreview,
  type TeamConnectionsState,
} from '../../src/team/device';
import { prepareSharedSnapshot } from '../../src/team/prepareSnapshot';
import { TeamApiError } from '../../src/team/readResponse';
import type { SecretVault } from '../services/secretVault';
import { TeamDeviceClient } from './client';
import { teamOrigin } from './origin';

const savedConnection = z
  .strictObject({
    id: teamId,
    origin: z.string(),
    deviceName: pairingStartSchema.shape.deviceName,
    credential: deviceSecret,
    opaqueSecret: z.string().regex(/^[a-f\d]{64}$/),
    state: z.enum(['pairing', 'connected', 'removing', 'unavailable']),
    pairing: z
      .strictObject({
        code: z.string(),
        expiresAt: z.number().int().positive(),
        interval: z.number().int().min(5).max(60),
      })
      .optional(),
    identity: pairedIdentity.optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.state === 'connected' && !value.identity) ||
      (value.state === 'pairing' && !value.pairing)
    )
      context.addIssue({ code: 'custom', message: 'Connection state is incomplete.' });
  });
const savedState = z.strictObject({
  version: z.literal(1),
  connections: z.array(savedConnection).max(10),
});
type Connection = z.infer<typeof savedConnection>;
export interface TeamSession {
  profile: Companion;
  client: TeamDeviceClient;
  key(value: string): string;
  current(): boolean;
}
type SharingReview = Omit<SharingPreview, 'snapshot'> & { expectedEpoch: number };

/** Main-process-only connection coordinator. Public state deliberately excludes
 * bearer credentials and HMAC secrets; pairing does not enable publication. */
export class TeamConnections {
  private connections: Connection[] = [];
  private profiles = new Map<string, { value: Companion; checkedAt: number }>();
  private errors = new Map<string, string>();
  private jobs = new Map<string, Promise<void>>();
  private next = new Map<string, number>();
  private storageError?: string;
  private beginning = false;
  private closed = false;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private reviews = new Map<string, SharingReview>();
  constructor(
    private vault: SecretVault,
    private snapshot: () => Snapshot,
    private publish: (value: TeamConnectionsState) => void,
    private options: {
      allowLoopback?: boolean;
      request?: typeof fetch;
      onRevoked?: (id: string) => void;
    } = {},
  ) {
    this.read();
  }

  private read() {
    try {
      const text = this.vault.read();
      const value = text ? savedState.parse(JSON.parse(text)) : { connections: [] };
      if (new Set(value.connections.map((c) => c.id)).size !== value.connections.length)
        throw new Error('Duplicate connection identities.');
      for (const connection of value.connections) {
        if (teamOrigin(connection.origin, this.options.allowLoopback) !== connection.origin)
          throw new Error('Invalid saved origin.');
      }
      this.connections = value.connections;
      this.storageError = undefined;
    } catch {
      this.connections = [];
      this.storageError =
        'Saved team connections could not be opened. Unlock macOS Keychain and retry. No local work is being shared.';
    }
  }
  state(): TeamConnectionsState {
    return {
      connections: this.connections.map(({ id, origin, deviceName, state, identity, pairing }) => ({
        id,
        origin,
        deviceName,
        state,
        identity,
        ...(state === 'pairing' && pairing
          ? { pairing: { code: pairing.code, expiresAt: pairing.expiresAt } }
          : {}),
        projects: this.profiles.get(id)?.value.projects,
        complete: this.profiles.get(id)?.value.complete.projects,
        checkedAt: this.profiles.get(id)?.checkedAt,
        error: this.errors.get(id),
      })),
      allowLoopback: this.options.allowLoopback === true,
      error: this.storageError,
    };
  }
  private emit() {
    if (!this.closed) this.publish(this.state());
  }
  private save(connections: Connection[]) {
    if (this.closed) throw new Error('Team connections have stopped.');
    savedState.parse({ version: 1, connections });
    this.vault.write(JSON.stringify({ version: 1, connections }));
    this.connections = connections;
  }
  private get(id: string) {
    const connection = this.connections.find((c) => c.id === teamId.parse(id));
    if (!connection) throw new Error('This team connection is no longer available.');
    return connection;
  }
  private replace(id: string, value?: Connection) {
    this.save(this.connections.flatMap((c) => (c.id !== id ? [c] : value ? [value] : [])));
  }
  private client(connection: Pick<Connection, 'origin' | 'credential'>) {
    return new TeamDeviceClient(connection.origin, connection.credential, this.options.request, {
      allowLoopback: this.options.allowLoopback,
      signal: this.abort.signal,
    });
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, 5000);
    void this.refresh();
  }
  async begin(input: unknown) {
    if (this.storageError) throw new Error(this.storageError);
    if (this.beginning || this.connections.length >= 10)
      throw new Error('Finish the current connection or remove an unused team first.');
    const { origin: raw, deviceName } = z
      .strictObject({
        origin: z.string().max(2048),
        deviceName: pairingStartSchema.shape.deviceName,
      })
      .parse(input);
    const origin = teamOrigin(raw, this.options.allowLoopback);
    this.beginning = true;
    try {
      const started = await new TeamDeviceClient(origin, undefined, this.options.request, {
        allowLoopback: this.options.allowLoopback,
        signal: this.abort.signal,
      }).begin(deviceName);
      const record: Connection = {
        id: randomUUID(),
        origin,
        deviceName,
        credential: started.pairingSecret,
        opaqueSecret: randomBytes(32).toString('hex'),
        state: 'pairing',
        pairing: {
          code: started.userCode,
          expiresAt: Date.now() + started.expiresIn * 1000,
          interval: started.interval,
        },
      };
      try {
        this.save([...this.connections, record]);
      } catch (error) {
        try {
          await this.client(record).cancel();
        } catch {}
        throw error;
      }
      this.next.set(record.id, Date.now() + started.interval * 1000);
      this.emit();
      return this.state();
    } finally {
      this.beginning = false;
    }
  }
  async refresh(force = false) {
    if (this.closed) return this.state();
    if (this.storageError && force) {
      this.read();
      this.emit();
    }
    if (!this.storageError) await Promise.all(this.connections.map((c) => this.run(c.id, force)));
    return this.state();
  }
  private run(id: string, force = false): Promise<void> {
    const existing = this.jobs.get(id);
    if (existing) return existing;
    const connection = this.get(id);
    // Force refresh never bypasses the pairing rate limit.
    if (Date.now() < (this.next.get(id) ?? 0) && (!force || connection.state === 'pairing'))
      return Promise.resolve();
    this.next.set(
      id,
      Date.now() +
        (connection.state === 'pairing' ? (connection.pairing?.interval ?? 5) * 1000 : 30000),
    );
    const task = this.sync(connection)
      .catch((error) => {
        if (this.closed || !this.connections.some((c) => c.id === id)) return;
        this.errors.set(
          id,
          error instanceof Error ? error.message : 'The team connection could not refresh.',
        );
      })
      .finally(() => {
        this.jobs.delete(id);
        this.emit();
      });
    this.jobs.set(id, task);
    return task;
  }
  private async sync(connection: Connection) {
    if (this.closed || connection.state === 'unavailable') return;
    const client = this.client(connection);
    try {
      if (connection.state === 'removing') {
        if (connection.identity)
          await client.revoke(connection.identity.workspaceId, connection.identity.deviceId);
        else {
          try {
            await client.cancel();
          } catch (error) {
            if (!(error instanceof TeamApiError && error.status === 409)) throw error;
            await client.cancel();
          }
        }
        if (this.closed) return;
        this.options.onRevoked?.(connection.id);
        this.replace(connection.id);
        this.profiles.delete(connection.id);
        this.errors.delete(connection.id);
        this.next.delete(connection.id);
        return;
      }
      if (connection.state === 'pairing') {
        const result = await client.poll();
        if (this.closed || this.get(connection.id).state !== 'pairing') return;
        if (result.state === 'pending') {
          this.errors.delete(connection.id);
          return;
        }
        const { state: _state, ...identity } = result;
        connection = { ...connection, state: 'connected', identity, pairing: undefined };
        this.replace(connection.id, connection);
      }
      const identity = connection.identity!;
      const profile = companionResponse.parse(await client.companion(identity.workspaceId));
      if (this.closed || this.get(connection.id).state !== 'connected') return;
      if (
        profile.workspace.id !== identity.workspaceId ||
        profile.device.id !== identity.deviceId ||
        profile.member.id !== identity.memberId
      )
        throw new Error('The team response does not match this device and account.');
      this.profiles.set(connection.id, { value: profile, checkedAt: Date.now() });
      this.errors.delete(connection.id);
      const updated = {
        ...identity,
        workspaceName: profile.workspace.name,
        login: profile.member.login,
        deviceName: profile.device.name,
        expiresAt: profile.device.expiresAt,
      };
      if (JSON.stringify(updated) !== JSON.stringify(identity))
        this.replace(connection.id, { ...connection, identity: updated });
    } catch (error) {
      if (this.closed) return;
      if (error instanceof TeamApiError && [401, 410].includes(error.status)) {
        const current = this.get(connection.id);
        // A concurrent local cancellation must remain durable until acknowledged.
        if (current.state === connection.state)
          this.replace(connection.id, { ...current, state: 'unavailable' });
        this.profiles.delete(connection.id);
      }
      throw error;
    }
  }
  async disconnect(id: string) {
    const connection = this.get(id);
    this.replace(id, { ...connection, state: 'removing' });
    this.profiles.delete(id);
    this.errors.delete(id);
    this.emit();
    await this.jobs.get(id);
    if (!this.closed && this.connections.some((c) => c.id === id)) await this.run(id, true);
    return this.state();
  }
  forget(id: string) {
    const connection = this.get(id);
    if (!['unavailable', 'removing'].includes(connection.state))
      throw new Error('Disconnect this device before forgetting its saved connection.');
    this.replace(id);
    this.profiles.delete(id);
    this.errors.delete(id);
    this.next.delete(id);
    this.emit();
    return this.state();
  }
  browserAddress(id: string) {
    return this.get(id).origin + '/';
  }
  connected(id: string) {
    return (
      !this.closed &&
      !this.storageError &&
      this.connections.some((c) => c.id === id && c.state === 'connected')
    );
  }
  async session(id: string): Promise<TeamSession> {
    await this.run(id, true);
    const connection = this.get(id),
      profile = this.profiles.get(connection.id);
    if (
      connection.state !== 'connected' ||
      !profile ||
      this.errors.has(connection.id) ||
      Date.now() - profile.checkedAt > 60000
    )
      throw new Error(this.errors.get(id) ?? 'Refresh the team connection before continuing.');
    return {
      profile: profile.value,
      client: this.client(connection),
      key: (value) =>
        createHmac('sha256', Buffer.from(connection.opaqueSecret, 'hex'))
          .update(value)
          .digest('hex'),
      current: () => this.connected(id),
    };
  }
  async preview(input: unknown): Promise<SharingPreview> {
    const command = localPreviewRequest.parse(input);
    const session = await this.session(command.connectionId);
    const project = session.profile.projects.find((p) => p.id === command.projectId && p.canShare);
    if (!project) throw new Error('This account cannot share into the selected team project.');
    const repository = this.snapshot().repositories.find((r) => r.id === command.repositoryId);
    if (!repository) throw new Error('This local project is no longer monitored.');
    const remote = session.profile.shares.find((s) => s.projectId === command.projectId);
    if (!remote && !session.profile.complete.shares)
      throw new Error(
        'The team sharing list is incomplete. Refresh before reviewing this project.',
      );
    const snapshot = prepareSharedSnapshot(repository, command.consent, session.key);
    const review = {
      ...command,
      id: randomUUID(),
      expiresAt: Date.now() + 300000,
      repositoryName: repository.name,
      projectName: project.name,
      teamName: session.profile.workspace.name,
    };
    for (const [id, value] of this.reviews)
      if (value.expiresAt <= Date.now()) this.reviews.delete(id);
    if (this.reviews.size >= 10) this.reviews.delete(this.reviews.keys().next().value!);
    this.reviews.set(review.id, { ...review, expectedEpoch: remote?.epoch ?? 0 });
    return { ...review, snapshot };
  }
  review(id: string): SharingReview {
    const review = this.reviews.get(teamId.parse(id));
    if (!review || review.expiresAt <= Date.now() || !this.connected(review.connectionId))
      throw new Error('Prepare a new metadata preview before enabling sharing.');
    if (!this.snapshot().repositories.some((r) => r.id === review.repositoryId))
      throw new Error('This local project is no longer monitored.');
    return review;
  }
  consumeReview(id: string) {
    this.reviews.delete(id);
  }
  close() {
    this.closed = true;
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    this.profiles.clear();
    this.reviews.clear();
  }
}
