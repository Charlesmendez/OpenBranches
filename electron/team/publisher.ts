import { createHash, randomUUID } from 'node:crypto';
import type { Snapshot } from '../../src/domain/types';
import type { TeamSharingState } from '../../src/team/publishing';
import { teamId } from '../../src/team/protocol';
import { prepareSharedSnapshot } from '../../src/team/prepareSnapshot';
import { TeamApiError } from '../../src/team/readResponse';
import type { SecretVault } from '../services/secretVault';
import type { TeamConnections, TeamSession } from './connections';
import { SharingRegistry, type ShareRecord } from './sharingState';

const sameConsent = (a: ShareRecord['consent'], b: ShareRecord['consent']) =>
  a.taskTitles === b.taskTitles && a.taskSummaries === b.taskSummaries;
const active = (r: ShareRecord) => ['starting', 'sharing', 'stopping'].includes(r.state);

/** At most four projects per pass. Only approved bindings can reach an upload;
 * each request is fenced by durable consent state and the server's epoch. */
export class TeamPublisher {
  private registry: SharingRegistry;
  private jobs = new Map<string, AbortController>();
  private errors = new Map<string, string>();
  private next = new Map<string, number>();
  private failures = new Map<string, number>();
  private localStops = new Set<string>();
  private approving = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<TeamSharingState>;
  private closed = false;
  private cursor = 0;
  constructor(
    vault: SecretVault,
    private connections: Pick<
      TeamConnections,
      'session' | 'connected' | 'review' | 'consumeReview'
    >,
    private snapshot: () => Snapshot,
    private publish: (state: TeamSharingState) => void,
  ) {
    this.registry = new SharingRegistry(vault);
  }
  state(): TeamSharingState {
    return {
      error: this.registry.error,
      shares: this.registry.all().map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        repositoryId: r.repositoryId,
        projectId: r.projectId,
        repositoryName: r.repositoryName,
        projectName: r.projectName,
        teamName: r.teamName,
        consent: r.consent,
        state: this.localStops.has(r.id) ? 'stopping' : r.state,
        lastUploadedAt: r.lastUploadedAt,
        observedAt: r.observedAt,
        error: this.errors.get(r.id) ?? r.reason,
        busy: this.jobs.has(r.id),
        stopSaved: !this.localStops.has(r.id),
      })),
    };
  }
  private emit() {
    if (!this.closed) this.publish(this.state());
  }
  start() {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, 5000);
    void this.refresh();
  }
  async approve(previewId: string) {
    teamId.parse(previewId);
    if (this.closed || this.registry.error)
      throw new Error(this.registry.error ?? 'Sharing has stopped.');
    if (this.approving.has(previewId))
      throw new Error('This sharing choice is already being saved.');
    this.approving.add(previewId);
    try {
      const review = this.connections.review(previewId);
      const session = await this.connections.session(review.connectionId);
      this.connections.review(previewId); // Expiry, connection, and monitoring may have changed.
      if (this.closed || !session.current()) throw new Error('Reconnect this team before sharing.');
      const project = session.profile.projects.find((p) => p.id === review.projectId && p.canShare);
      const remote = session.profile.shares.find((s) => s.projectId === review.projectId);
      if (
        !project ||
        (!remote && !session.profile.complete.shares) ||
        (remote?.epoch ?? 0) !== review.expectedEpoch
      )
        throw new Error('Team access or sharing changed. Prepare a new metadata preview.');
      const previous = this.registry
        .all()
        .find((r) => r.connectionId === review.connectionId && r.projectId === review.projectId);
      if (previous && (previous.state !== 'stopped' || this.jobs.has(previous.id)))
        throw new Error('Stop the current sharing for this team destination before replacing it.');
      const record: ShareRecord = {
        id: randomUUID(),
        connectionId: review.connectionId,
        repositoryId: review.repositoryId,
        projectId: review.projectId,
        repositoryName: review.repositoryName,
        projectName: review.projectName,
        teamName: review.teamName,
        consent: review.consent,
        state: 'starting',
        epoch: review.expectedEpoch,
        sequence: 0,
        approvalExpiresAt: review.expiresAt,
      };
      // This write precedes every enabling request. Renderer-supplied payloads
      // and consent fields are never accepted by the approval endpoint.
      this.registry.save([...this.registry.all().filter((r) => r !== previous), record]);
      if (previous) {
        this.next.delete(previous.id);
        this.failures.delete(previous.id);
        this.errors.delete(previous.id);
      }
      this.connections.consumeReview(previewId);
      this.emit();
      void this.refresh();
      return this.state();
    } finally {
      this.approving.delete(previewId);
    }
  }
  stop(id: string) {
    const record = this.get(id);
    if (record.state === 'stopped') return this.state();
    // Pause this process even if persistence fails; the visible pending state
    // distinguishes an unsaved stop from a durable offline withdrawal.
    this.localStops.add(id);
    this.jobs.get(id)?.abort();
    try {
      this.saveStop(record);
    } catch {
      this.errors.set(
        id,
        'Could not save Stop sharing. Uploads are paused on this running Mac. Keep the app open and retry before restarting.',
      );
      this.emit();
      throw new Error(this.errors.get(id)!);
    }
    this.emit();
    void this.refresh();
    return this.state();
  }
  private saveStop(record: ShareRecord) {
    this.registry.replace({ ...record, state: 'stopping', reason: undefined });
    this.localStops.delete(record.id);
    this.errors.delete(record.id);
    this.next.delete(record.id);
  }
  prepareStopUnselected(next: Snapshot) {
    if (this.registry.error)
      throw new Error(
        'Saved team sharing choices are unavailable. Unlock Keychain and refresh sharing before removing a project.',
      );
    const selected = new Set(next.repositories.map((r) => r.id));
    const removed = this.registry
      .all()
      .filter((r) => !selected.has(r.repositoryId) && !['stopping', 'stopped'].includes(r.state));
    if (!removed.length) return () => {};
    const ids = new Set(removed.map((r) => r.id));
    const adopt = this.registry.prepare(
      this.registry
        .all()
        .map((r) => (ids.has(r.id) ? { ...r, state: 'stopping', reason: undefined } : r)),
    );
    return () => {
      adopt();
      for (const id of ids) {
        this.jobs.get(id)?.abort();
        this.next.delete(id);
      }
      this.emit();
      void this.refresh();
    };
  }
  forget(id: string) {
    const record = this.get(id);
    if (record.state !== 'stopped' && this.connections.connected(record.connectionId))
      throw new Error('Wait for Stop sharing to finish before removing this record.');
    this.jobs.get(id)?.abort();
    this.registry.save(this.registry.all().filter((r) => r.id !== id));
    this.errors.delete(id);
    this.localStops.delete(id);
    this.next.delete(id);
    this.failures.delete(id);
    this.emit();
    return this.state();
  }
  /** Called only after the connection coordinator receives revocation success. */
  confirmedRevocation(connectionId: string) {
    const records = this.registry.all().filter((r) => r.connectionId === connectionId);
    for (const record of records) this.jobs.get(record.id)?.abort();
    try {
      this.registry.save(
        this.registry
          .all()
          .map((r) =>
            r.connectionId === connectionId
              ? { ...r, state: 'stopped', reason: undefined, digest: undefined }
              : r,
          ),
      );
      for (const record of records) {
        this.localStops.delete(record.id);
        this.errors.delete(record.id);
      }
    } catch {
      for (const record of records)
        this.errors.set(
          record.id,
          'The device was revoked, but its local sharing record could not be saved. Retry or remove this local record.',
        );
    }
    this.emit();
  }
  private get(id: string) {
    const record = this.registry.get(teamId.parse(id));
    if (!record || this.closed) throw new Error('This sharing record is no longer available.');
    return record;
  }
  refresh(retryStorage = false): Promise<TeamSharingState> {
    if (this.closed) return Promise.resolve(this.state());
    if (this.running) return this.running;
    if (retryStorage) this.next.clear();
    if (retryStorage && this.registry.error) {
      this.registry.read();
      this.emit();
    }
    this.running = this.tick()
      .catch(() => {
        // Per-project failures are surfaced below; a failed stop write must not
        // become an unhandled timer rejection or resume uploads.
      })
      .then(() => this.state())
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async tick() {
    if (this.registry.error) return;
    for (const id of this.localStops) {
      const record = this.registry.get(id);
      if (record) {
        try {
          this.saveStop(record);
        } catch {
          /* Remains paused with its visible storage error. */
        }
      } else this.localStops.delete(id);
    }
    const records = this.registry.all();
    if (!records.length) return;
    const rotated = [...records.slice(this.cursor), ...records.slice(0, this.cursor)];
    const due = rotated
      .filter(
        (r) => active(r) && !this.localStops.has(r.id) && (this.next.get(r.id) ?? 0) <= Date.now(),
      )
      .slice(0, 4);
    if (!due.length) return;
    this.cursor = (records.indexOf(due[due.length - 1]) + 1) % records.length;
    const sessions = new Map<string, Promise<TeamSession>>();
    await Promise.all(
      due.map((record) => {
        if (!sessions.has(record.connectionId)) {
          const value = this.connections.connected(record.connectionId)
            ? this.connections.session(record.connectionId)
            : Promise.reject(
                new Error(
                  'This team connection is unavailable. Reconnect or ask the team owner to revoke its device.',
                ),
              );
          sessions.set(record.connectionId, value);
        }
        return this.sync(record, sessions.get(record.connectionId)!);
      }),
    );
  }
  private async sync(initial: ShareRecord, sessionPromise: Promise<TeamSession>) {
    let record = initial;
    const controller = new AbortController();
    this.jobs.set(record.id, controller);
    this.next.set(record.id, Date.now() + 30000);
    this.emit();
    const current = () =>
      !this.closed &&
      !controller.signal.aborted &&
      !this.localStops.has(record.id) &&
      this.registry.get(record.id) === record;
    const replace = (changes: Partial<ShareRecord>) => {
      record = this.registry.replace({ ...record, ...changes });
    };
    try {
      const session = await sessionPromise;
      if (!current() || !session.current()) return;
      const remote = session.profile.shares.find((s) => s.projectId === record.projectId);
      if (!remote && !session.profile.complete.shares)
        throw new Error('The team sharing list is incomplete. No metadata was sent.');
      if (record.state === 'stopping') {
        // Even an uncertain first enable needs a disabled epoch beyond its
        // expected epoch. Merely observing "absent" cannot fence a late PUT.
        if (!(remote && !remote.enabled && remote.epoch > record.epoch)) {
          const result = await session.client.changeSharing(
            session.profile.workspace.id,
            record.projectId,
            {
              expectedEpoch: remote?.epoch ?? 0,
              enabled: false,
              consent: { taskTitles: false, taskSummaries: false },
            },
            controller.signal,
          );
          if (!current() || !session.current()) return;
          replace({ epoch: result.epoch });
        }
        if (current()) replace({ state: 'stopped', reason: undefined, digest: undefined });
        this.errors.delete(record.id);
        return;
      }
      const project = session.profile.projects.find((p) => p.id === record.projectId && p.canShare);
      if (!project) {
        replace({
          state: 'paused',
          reason:
            'Sharing access changed. This Mac will not resume automatically. Stop sharing, then review the project again.',
        });
        return;
      }
      const repository = this.snapshot().repositories.find((r) => r.id === record.repositoryId);
      if (!repository) {
        replace({ state: 'stopping', reason: undefined });
        this.next.delete(record.id);
        return;
      }
      if (
        record.repositoryName !== repository.name ||
        record.projectName !== project.name ||
        record.teamName !== session.profile.workspace.name
      )
        replace({
          repositoryName: repository.name,
          projectName: project.name,
          teamName: session.profile.workspace.name,
        });
      if (record.state === 'starting') {
        if (
          remote?.enabled &&
          remote.epoch === record.epoch + 1 &&
          sameConsent(remote.consent, record.consent)
        ) {
          // The preceding enable may have committed even if its reply was lost.
          replace({ state: 'sharing', epoch: remote.epoch, sequence: remote.sequence });
        } else if (
          (remote?.epoch ?? 0) !== record.epoch ||
          Date.now() >= record.approvalExpiresAt
        ) {
          replace({
            state: 'stopping',
            reason:
              'The sharing approval changed or expired. Waiting for withdrawal before a new review.',
          });
          this.next.delete(record.id);
          return;
        } else {
          const result = await session.client.changeSharing(
            session.profile.workspace.id,
            record.projectId,
            {
              expectedEpoch: record.epoch,
              enabled: true,
              consent: record.consent,
            },
            controller.signal,
          );
          if (!current() || !session.current()) return;
          if (
            result.epoch !== record.epoch + 1 ||
            !result.enabled ||
            !sameConsent(result.consent, record.consent)
          )
            throw new Error('The team service did not confirm the reviewed sharing choices.');
          replace({ state: 'sharing', epoch: result.epoch, sequence: result.sequence });
        }
      } else if (
        !remote?.enabled ||
        remote.epoch !== record.epoch ||
        !sameConsent(remote.consent, record.consent)
      ) {
        replace({
          state: 'paused',
          reason:
            'Sharing was changed or withdrawn by the team. This Mac will not enable it again automatically.',
        });
        return;
      }
      // Re-read the repository after asynchronous access/consent operations.
      const latest = this.snapshot().repositories.find((r) => r.id === record.repositoryId);
      if (!current() || !session.current()) return;
      if (!latest) {
        replace({ state: 'stopping' });
        this.next.delete(record.id);
        return;
      }
      const snapshot = prepareSharedSnapshot(latest, record.consent, session.key);
      const observed = Date.parse(snapshot.observedAt);
      if (observed > Date.now() + 60000 || observed < Date.now() - 86400000)
        throw new Error('Refresh the local project before uploading its metadata.');
      const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      if (digest === record.digest && Date.now() - (record.lastUploadedAt ?? 0) < 120000) {
        this.errors.delete(record.id);
        this.failures.delete(record.id);
        return;
      }
      const sequence = Math.max(record.sequence, remote?.sequence ?? 0) + 1;
      // Reserve the sequence before sending. After a lost reply/restart, fresh
      // server state and the reserved value prevent duplicate/older uploads.
      replace({ sequence });
      if (!current() || !session.current()) return;
      const result = await session.client.publishSnapshot(
        session.profile.workspace.id,
        record.projectId,
        {
          epoch: record.epoch,
          sequence,
          snapshot,
        },
        controller.signal,
      );
      if (!current() || !session.current()) return;
      if (result.sequence !== sequence)
        throw new Error('The team did not acknowledge this metadata update.');
      replace({
        lastUploadedAt: Date.now(),
        observedAt: snapshot.observedAt,
        digest,
        reason: undefined,
      });
      this.errors.delete(record.id);
      this.failures.delete(record.id);
    } catch (error) {
      if (!current()) return;
      const failures = Math.min(5, (this.failures.get(record.id) ?? 0) + 1);
      this.failures.set(record.id, failures);
      this.next.set(record.id, Date.now() + Math.min(300000, 15000 * 2 ** failures));
      this.errors.set(
        record.id,
        error instanceof Error ? error.message : 'Sharing could not refresh.',
      );
      if (
        record.state !== 'stopping' &&
        (!this.connections.connected(record.connectionId) ||
          (error instanceof TeamApiError && [401, 403, 410].includes(error.status)))
      ) {
        try {
          replace({
            state: 'paused',
            reason: 'Access changed. Review this project again before sharing resumes.',
          });
        } catch {
          /* Server still enforces the revoked access. */
        }
      }
    } finally {
      this.jobs.delete(record.id);
      this.emit();
    }
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.jobs.values()) controller.abort();
  }
}
