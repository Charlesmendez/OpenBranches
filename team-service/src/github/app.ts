import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { GitHubTransport, GitHubError } from '../../../src/github/transport';
import { readRemote, type RemoteSnapshot } from '../../../src/github/reader';
import { retainPartialPulls } from '../../../src/github/pulls';
import {
  githubId,
  installationBinding,
  installationSchema,
  installationTokenSchema,
  repositoryPageSchema,
  repositorySchema,
  project,
  type InstallationBinding,
  type GitHubProject,
} from './schema';

const readPermissions = {
  metadata: 'read',
  contents: 'read',
  pull_requests: 'read',
  checks: 'read',
  statuses: 'read',
} as const;
interface ReadOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  previous?: { repositoryId: string; snapshot: RemoteSnapshot };
}
interface Operation {
  signal: AbortSignal;
  current(): void;
  get(
    path: string,
    token: string,
    body?: unknown,
    maxBytes?: number,
  ): Promise<{ body: unknown; hasNext: boolean }>;
}

/** Provider adapter only: the service must separately authorize a workspace
 * owner and bind their verified installation before invoking this class.
 * No keys/tokens escape in return values, and no repository writes exist. */
export class TeamGitHubApp {
  private key: KeyObject;
  private transport: GitHubTransport;
  private clientId: string;
  constructor(clientId: string, privateKey: string, request: typeof fetch = fetch) {
    this.clientId = z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,100}$/)
      .parse(clientId);
    try {
      this.key = createPrivateKey(privateKey);
      if (
        this.key.asymmetricKeyType !== 'rsa' ||
        (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new Error();
    } catch {
      throw new Error('Configure a valid RSA GitHub App private key of at least 2048 bits.');
    }
    this.transport = new GitHubTransport(request);
  }
  private jwt() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.clientId }),
    ).toString('base64url');
    const data = header + '.' + claims;
    return data + '.' + sign('RSA-SHA256', Buffer.from(data), this.key).toString('base64url');
  }
  private operation(options: ReadOptions): Operation {
    const signal = AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    let remaining = 120;
    const current = () => {
      if (signal.aborted || options.isCurrent?.() === false)
        throw new GitHubError('The GitHub refresh was cancelled or exceeded its time limit.', 0);
    };
    return {
      signal,
      current,
      get: async (path, token, body, maxBytes) => {
        current();
        if (--remaining < 0)
          throw new GitHubError(
            'GitHub refresh reached its request limit. Refresh to continue.',
            0,
          );
        const response = await this.transport.json(path, token, { signal, body, maxBytes });
        current();
        return response;
      },
    };
  }
  private async installation(
    binding: InstallationBinding,
    operation: Operation,
    required: Readonly<Record<string, string>> = { metadata: 'read' },
  ) {
    const response = await operation.get(
      '/app/installations/' + binding.installationId,
      this.jwt(),
      undefined,
      256_000,
    );
    const parsed = installationSchema.safeParse(response.body);
    if (!parsed.success) throw new Error('GitHub returned an unsupported installation identity.');
    const value = parsed.data;
    if (
      String(value.id) !== binding.installationId ||
      String(value.account.id) !== binding.accountId ||
      value.account.type !== binding.accountType ||
      value.suspended_at !== null ||
      (value.client_id !== undefined && value.client_id !== this.clientId)
    )
      throw new Error(
        'The GitHub installation changed or is suspended. Review the connection again.',
      );
    if (Object.keys(required).some((key) => !Object.hasOwn(value.permissions, key)))
      throw new Error('The GitHub App needs the configured read permissions for this source.');
    return value;
  }
  private async token(binding: InstallationBinding, operation: Operation, repositoryId?: string) {
    const permissions = repositoryId ? readPermissions : ({ metadata: 'read' } as const);
    await this.installation(binding, operation, permissions);
    const response = await operation.get(
      '/app/installations/' + binding.installationId + '/access_tokens',
      this.jwt(),
      {
        permissions,
        ...(repositoryId ? { repository_ids: [Number(repositoryId)] } : {}),
      },
      2_000_000,
    );
    const parsed = installationTokenSchema.safeParse(response.body);
    if (!parsed.success) throw new Error('GitHub returned an unsupported installation credential.');
    const value = parsed.data;
    // Refuse broader permissions, missing permissions, and unusable lifetimes.
    if (
      Object.entries(value.permissions).some(
        ([key, access]) => !Object.hasOwn(permissions, key) || access !== 'read',
      ) ||
      Object.keys(permissions).some((key) => value.permissions[key] !== 'read') ||
      Date.parse(value.expires_at) < Date.now() + 60_000 ||
      Date.parse(value.expires_at) > Date.now() + 70 * 60_000
    )
      throw new Error('GitHub did not confirm the requested read-only permissions and expiration.');
    return value.token;
  }
  async catalog(input: InstallationBinding, options: ReadOptions = {}) {
    const binding = installationBinding.parse(input),
      operation = this.operation(options);
    const token = await this.token(binding, operation);
    const projects = new Map<string, GitHubProject>();
    const observedAt = new Date().toISOString();
    let complete = false,
      total = 0;
    for (let page = 1; page <= 10; page++) {
      const response = await operation.get(
        '/installation/repositories?per_page=100&page=' + page,
        token,
      );
      const parsed = repositoryPageSchema.safeParse(response.body);
      if (!parsed.success) throw new Error('GitHub returned an unsupported repository list.');
      total = Math.max(total, parsed.data.total_count);
      for (const repository of parsed.data.repositories) {
        const value = project(repository, binding),
          previous = projects.get(value.id);
        if (previous && previous.fullName !== value.fullName)
          throw new Error('GitHub repositories changed during this read. Refresh again.');
        projects.set(value.id, value);
      }
      if (!response.hasNext) {
        complete = projects.size >= total;
        break;
      }
    }
    await this.installation(binding, operation);
    return { projects: [...projects.values()], complete, total, observedAt };
  }
  async read(input: InstallationBinding, id: string, options: ReadOptions = {}) {
    const binding = installationBinding.parse(input),
      repositoryId = githubId.parse(id);
    const operation = this.operation(options);
    const token = await this.token(binding, operation, repositoryId);
    // The scoped token's own repository list must contain exactly the approved
    // stable ID. Never resolve consent by a potentially reused repository name.
    const scoped = await operation.get('/installation/repositories?per_page=100&page=1', token);
    const parsed = repositoryPageSchema.safeParse(scoped.body);
    if (
      !parsed.success ||
      scoped.hasNext ||
      parsed.data.total_count !== 1 ||
      parsed.data.repositories.length !== 1 ||
      String(parsed.data.repositories[0].id) !== repositoryId
    )
      throw new Error('GitHub did not confirm access to exactly the selected repository.');
    const selected = project(parsed.data.repositories[0], binding);
    const prefix = '/repos/' + selected.fullName.split('/').map(encodeURIComponent).join('/');
    const identity = async () => {
      const response = await operation.get(prefix, token, undefined, 256_000);
      const value = repositorySchema.safeParse(response.body);
      if (
        !value.success ||
        String(value.data.id) !== repositoryId ||
        project(value.data, binding).fullName !== selected.fullName
      )
        throw new Error('The GitHub repository moved or changed during this read. Refresh again.');
    };
    await identity();
    const previous =
      options.previous?.repositoryId === repositoryId &&
      options.previous.snapshot.repository === selected.fullName
        ? options.previous.snapshot
        : undefined;
    const snapshot = await readRemote(
      {
        get: (path) => {
          if (!path.startsWith(prefix + '/')) throw new Error('Unexpected repository read.');
          return operation.get(path, token);
        },
      },
      selected.fullName,
      'github',
      {
        previous: previous?.history,
        previousPulls: previous?.pulls,
        budget: { remaining: 8, milliseconds: 10_000 },
        signalsBudget: { remaining: 12, milliseconds: 15_000 },
        isCurrent: () => !operation.signal.aborted && options.isCurrent?.() !== false,
      },
    );
    await identity();
    await this.installation(binding, operation, readPermissions);
    operation.current();
    return { project: selected, snapshot: retainPartialPulls(snapshot, previous) };
  }
}
