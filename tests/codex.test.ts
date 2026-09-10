import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { CodexInspectionClient, type InspectionMethod } from '../electron/codex/transport';
import {
  readTaskIndex,
  readLiveTasks,
  indexSchema,
  type CodexTask,
  type CodexIndex,
} from '../electron/codex/reader';
import { associateTask, linkRepository } from '../electron/codex/associations';
import { supportedVersion } from '../electron/codex/executable';
import { CodexService } from '../electron/codex/service';
import type { Repository, Snapshot } from '../src/domain/types';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.useRealTimers();
});
const sha = 'a'.repeat(40);
const checkedAt = '2026-09-09T12:00:00.000Z';
function repository(): Repository {
  const ref = {
    name: 'codex/search',
    fullName: 'refs/heads/codex/search',
    sha,
    updatedAt: checkedAt,
    subject: 'Search',
  };
  const worktree = {
    path: '/fixture/atlas-search',
    head: sha,
    branch: 'codex/search',
    detached: false,
    available: true,
    dirty: false,
    changedFiles: 0,
  };
  return {
    id: 'atlas',
    name: 'atlas',
    path: '/fixture/atlas',
    commonDir: '/fixture/atlas/.git',
    targets: [],
    remotes: [{ name: 'origin', url: 'git@github.com:fictional/atlas.git' }],
    scannedAt: checkedAt,
    shallow: false,
    worktrees: [worktree],
    branches: [
      {
        id: 'search',
        repositoryId: 'atlas',
        name: ref.name,
        title: 'Search',
        local: ref,
        worktrees: [worktree],
        updatedAt: checkedAt,
        integration: {},
        codexNamed: true,
        detached: false,
      },
    ],
  };
}
function task(overrides: Partial<CodexTask> = {}): CodexTask {
  return {
    id: 'fixture-task',
    name: 'Improve search',
    cwd: '/fixture/atlas-search',
    createdAt: 1788948000,
    updatedAt: 1788951600,
    archived: false,
    gitInfo: { branch: 'codex/search', sha, originUrl: 'https://github.com/fictional/atlas' },
    ...overrides,
  };
}
function harness() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(() => {
      process.signalCode = 'SIGTERM';
      queueMicrotask(() => process.emit('exit', null, 'SIGTERM'));
      return true;
    }),
  });
  const sent: Record<string, any>[] = [];
  process.stdin.on('data', (chunk: Buffer) => sent.push(JSON.parse(chunk.toString())));
  const client = new CodexInspectionClient(process as unknown as ChildProcessWithoutNullStreams);
  cleanup.push(() => client.close());
  return {
    process,
    client,
    sent,
    reply: (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n'),
  };
}

describe('Codex inspection transport', () => {
  it('handshakes, handles fragmented UTF-8 and notifications, and exposes no mutation methods', async () => {
    const { client, sent, process, reply } = harness();
    const initialized = client.initialize();
    expect(sent[0].method).toBe('initialize');
    reply({ id: sent[0].id, result: { userAgent: 'fixture' } });
    await initialized;
    expect(sent[1]).toEqual({ method: 'initialized', params: {} });
    const pending = client.request('thread/list', {});
    reply({ method: 'account/updated', params: {} });
    const response = Buffer.from(
      JSON.stringify({ id: sent[2].id, result: { name: 'Café 🌱' } }) + '\n',
    );
    const split = response.indexOf(Buffer.from('🌱')) + 1;
    process.stdout.write(response.subarray(0, split));
    process.stdout.write(response.subarray(split));
    await expect(pending).resolves.toEqual({ name: 'Café 🌱' });
    for (const method of [
      'turn/start',
      'thread/resume',
      'command/exec',
      'config/value/write',
      'account/logout',
    ])
      await expect(client.request(method as InspectionMethod, {})).rejects.toThrow(
        'Unsupported inspection method',
      );
    expect(sent).toHaveLength(3);
  });

  it('refuses server actions and closes instead of approving a command', async () => {
    const { client, sent, reply, process } = harness();
    const pending = client.request('thread/list', {});
    const assertion = expect(pending).rejects.toThrow('requested an action');
    reply({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'private-command' },
    });
    await assertion;
    expect(sent[1]).toEqual({
      id: 'approval-1',
      error: { code: -32601, message: 'Inspection only.' },
    });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it('bounds input and hides private provider errors', async () => {
    const { client, sent, reply } = harness();
    const pending = client.request('thread/list', {});
    reply({ id: sent[0].id, error: { message: 'private-token-and-path' } });
    await expect(pending).rejects.toThrow('could not read its task index');
    const oversized = client.request('thread/list', {});
    const assertion = expect(oversized).rejects.toThrow('more data');
    reply({ id: sent[1].id, result: 'x'.repeat(8 * 1024 * 1024) });
    await assertion;
  });

  it('cleans up pending requests after malformed output, timeout, or exit', async () => {
    const malformed = harness();
    const first = malformed.client.request('thread/list', {});
    const firstAssertion = expect(first).rejects.toThrow('unreadable');
    malformed.process.stdout.write('invalid json\n');
    await firstAssertion;
    vi.useFakeTimers();
    const timeout = harness();
    const second = timeout.client.request('thread/list', {}, 50);
    const secondAssertion = expect(second).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await secondAssertion;
    const exited = harness();
    const third = exited.client.request('thread/list', {});
    const thirdAssertion = expect(third).rejects.toThrow('stopped');
    exited.process.exitCode = 1;
    exited.process.emit('exit', 1);
    await thirdAssertion;
  });
});

describe('Codex task discovery', () => {
  it('pages through current and archived history without reading prompts or repairing logs', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            ...task(),
            preview: 'Private initial prompt',
            path: '/private/rollout.jsonl',
            status: { type: 'active' },
          },
        ],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({ data: [task({ id: 'second' })], nextCursor: null })
      .mockResolvedValueOnce({ data: [task({ id: 'archived' })], nextCursor: null });
    const index = await readTaskIndex({ request });
    expect(index.tasks).toHaveLength(3);
    expect(index.tasks[2].archived).toBe(true);
    expect(index.partial).toBe(false);
    expect(request.mock.calls.map(([, p]) => [p.archived, p.cursor])).toEqual([
      [false, null],
      [false, 'next'],
      [true, null],
    ]);
    expect(
      request.mock.calls.every(
        ([method, p]) =>
          method === 'thread/list' &&
          p.useStateDbOnly === true &&
          p.sourceKinds.includes('appServer'),
      ),
    ).toBe(true);
    expect(JSON.stringify(index)).not.toMatch(/Private initial prompt|rollout|"status"/);
  });

  it('retains repository identity without credentials embedded in an origin URL', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          task({
            gitInfo: {
              branch: 'codex/search',
              sha,
              originUrl:
                'https://user:secret@github.com/Fictional/Atlas.git?token=private#fragment',
            },
          }),
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    const index = await readTaskIndex({ request });
    expect(index.tasks[0].gitInfo?.originUrl).toBe('https://github.com/fictional/atlas');
    expect(JSON.stringify(index)).not.toMatch(/secret|token|private|fragment/);
  });

  it('marks malformed entries and pagination loops as partial instead of inventing a complete index', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [task(), { id: 'bad' }], nextCursor: 'loop' })
      .mockResolvedValueOnce({ data: [task()], nextCursor: 'loop' })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    const index = await readTaskIndex({ request });
    expect(index.tasks).toHaveLength(1);
    expect(index.partial).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not assume older or unknown major protocol versions are supported', () => {
    expect(supportedVersion('codex-cli 0.144.4')).toBe(true);
    expect(supportedVersion('codex-cli 0.145.0')).toBe(true);
    for (const version of [
      'codex-cli 0.144.3',
      'codex-cli 1.0.0',
      'other-cli 0.144.4',
      'codex-cli 0.144.4-alpha',
    ])
      expect(supportedVersion(version)).toBe(false);
  });
});

describe('task association evidence', () => {
  it('attributes runtime activity only to a fresh matching checkout, even when another branch matches the saved commit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(checkedAt));
    const repo = repository();
    const live = task({ runtime: { state: 'active', checkedAt, source: 'codex-runtime' } });
    expect(associateTask(repo, repo.branches[0], live, checkedAt)).toMatchObject({
      status: 'active',
      activitySource: 'codex-runtime',
    });
    repo.branches[0].worktrees = [];
    expect(associateTask(repo, repo.branches[0], live, checkedAt)).toMatchObject({
      association: 'verified',
      status: 'unknown',
    });
    repo.branches[0].worktrees = repo.worktrees;
    const stale = task({
      runtime: {
        state: 'active',
        checkedAt: new Date(Date.parse(checkedAt) - 100000).toISOString(),
        source: 'codex-runtime',
      },
    });
    expect(associateTask(repo, repo.branches[0], stale, checkedAt)?.status).toBe('unknown');
    repo.scannedAt = new Date(Date.parse(checkedAt) - 180000).toISOString();
    expect(associateTask(repo, repo.branches[0], live, checkedAt)?.status).toBe('unknown');
  });
  it('uses the current checkout after a branch switch without relabeling the saved branch as running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(checkedAt));
    const repo = repository();
    const previous = repo.branches[0];
    const current = {
      ...previous,
      id: 'current',
      name: 'feat/current',
      local: { ...previous.local!, name: 'feat/current' },
      worktrees: [{ ...repo.worktrees[0], branch: 'feat/current' }],
    };
    repo.branches = [{ ...previous, worktrees: [] }, current];
    repo.worktrees = current.worktrees;
    const linked = linkRepository(
      repo,
      [task({ runtime: { state: 'active', checkedAt, source: 'codex-runtime' } })],
      checkedAt,
    );
    expect(linked.branches.map((b) => b.tasks?.[0]?.status)).toEqual(['unknown', 'active']);
  });
  it('uses detached worktree heads when there is no named ref', () => {
    const repo = repository();
    repo.branches[0] = {
      ...repo.branches[0],
      local: undefined,
      name: 'Detached at aaaaaaa',
      detached: true,
      worktrees: [{ ...repo.worktrees[0], detached: true, branch: undefined }],
    };
    expect(linkRepository(repo, [task()], checkedAt).branches[0].tasks?.[0].association).toBe(
      'possible',
    );
    expect(
      linkRepository(repo, [task({ cwd: '/fixture/another-worktree' })], checkedAt).branches[0]
        .tasks,
    ).toEqual([]);
  });

  it('identifies which copy supplies matching commit evidence', () => {
    const repo = repository();
    const branch = repo.branches[0];
    branch.remote = { ...branch.local!, remote: 'origin' };
    branch.local = { ...branch.local!, sha: 'b'.repeat(40) };
    expect(associateTask(repo, branch, task(), checkedAt)?.evidence).toContain(
      'Saved commit matches the remote branch tip.',
    );
  });
  it('requires repository, branch, and commit evidence for a verified saved link', () => {
    const repo = repository();
    const branch = repo.branches[0];
    expect(associateTask(repo, branch, task(), checkedAt)).toMatchObject({
      association: 'verified',
      status: 'unknown',
      checkedAt,
    });
    expect(
      associateTask(
        repo,
        branch,
        task({ gitInfo: { branch: 'codex/search', sha: 'b'.repeat(40) } }),
        checkedAt,
      )?.association,
    ).toBe('possible');
    expect(
      associateTask(repo, branch, task({ cwd: '/fixture/removed-worktree' }), checkedAt)
        ?.association,
    ).toBe('possible');
    expect(
      associateTask(repo, branch, task({ gitInfo: { branch: 'codex/unrelated', sha } }), checkedAt),
    ).toBeUndefined();
    expect(
      associateTask(
        repo,
        branch,
        task({ cwd: '/unrelated', gitInfo: { branch: 'codex/search', sha } }),
        checkedAt,
      ),
    ).toBeUndefined();
    expect(associateTask(repo, branch, task({ gitInfo: null }), checkedAt)).toBeUndefined();
  });

  it('retains multiple tasks and archived evidence without claiming live activity or fabricating a title', () => {
    const repo = repository();
    const linked = linkRepository(
      repo,
      [task(), task({ id: 'older', name: null, archived: true, updatedAt: 1788000000 })],
      checkedAt,
    );
    expect(linked.branches[0].tasks).toHaveLength(2);
    expect(linked.branches[0].tasks?.[1]).toMatchObject({
      title: 'Untitled Codex task',
      archived: true,
      status: 'unknown',
    });
    expect(repo.branches[0].tasks).toBeUndefined();
  });

  it('links a thousand branches without hiding matches in larger task histories', () => {
    const repo = repository();
    repo.branches = Array.from({ length: 1000 }, (_, i) => ({
      ...repo.branches[0],
      id: `branch-${i}`,
      name: `codex/work-${i}`,
    }));
    const tasks = Array.from({ length: 10000 }, (_, i) =>
      task({ id: `task-${i}`, gitInfo: { branch: `codex/work-${i % 1000}`, sha } }),
    );
    const linked = linkRepository(repo, tasks, checkedAt);
    expect(linked.branches).toHaveLength(1000);
    expect(
      linked.branches.every(
        (b) => b.tasks?.length === 10 && b.tasks.every((t) => t.association === 'verified'),
      ),
    ).toBe(true);
  });
});

describe('live task metadata', () => {
  it('reads loaded statuses without turns, distinguishes waiting, and strips runtime from persisted indexes', async () => {
    const request = vi.fn(async (method: string, params: any) =>
      method === 'thread/loaded/list'
        ? { data: ['running', 'waiting', 'idle'], nextCursor: null }
        : {
            thread: {
              ...task({ id: params.threadId }),
              status: {
                type: params.threadId === 'idle' ? 'idle' : 'active',
                activeFlags: params.threadId === 'waiting' ? ['waitingOnUserInput'] : [],
              },
              turns: [{ privatePrompt: 'private turn text' }],
              preview: 'private preview',
            },
          },
    );
    const index = await readLiveTasks({ request });
    expect(index.partial).toBe(false);
    expect(index.tasks.map((task) => task.runtime?.state)).toEqual(['active', 'waiting', 'idle']);
    expect(
      request.mock.calls
        .slice(1)
        .every(([method, params]) => method === 'thread/read' && params.includeTurns === false),
    ).toBe(true);
    expect(JSON.stringify(index)).not.toMatch(/private turn|private preview|turns/);
    expect(JSON.stringify(indexSchema.parse(index))).not.toContain('runtime');
  });
  it('reports incomplete coverage and excludes responses for a different thread', async () => {
    const request = vi.fn(async (method: string, params: any) => {
      if (method === 'thread/loaded/list')
        return { data: ['good', 'wrong', 'failed'], nextCursor: 'more' };
      if (params.threadId === 'failed') throw new Error('unavailable');
      return {
        thread: {
          ...task({ id: params.threadId === 'wrong' ? 'different' : 'good' }),
          status: { type: 'active', activeFlags: [] },
        },
      };
    });
    const index = await readLiveTasks({ request });
    expect(index.partial).toBe(true);
    expect(index.tasks.map((task) => task.id)).toEqual(['good']);
  });
});

async function serviceFixture(read: () => Promise<CodexIndex>) {
  const directory = await mkdtemp(join(tmpdir(), 'openbranches-codex-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const values = new Map<string, unknown>();
  const store = {
    read: <T>(key: string, fallback: T): T => (values.get(key) ?? fallback) as T,
    write: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const snapshot: Snapshot = {
    repositories: [repository()],
    events: [],
    updatedAt: checkedAt,
    scanning: false,
  };
  const clients: {
    initialize: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const service = new CodexService(store, directory, () => snapshot, vi.fn(), {
    find: async () => ({ path: '/fixture/codex', version: 'codex-cli 0.144.4', supported: true }),
    launch: () => {
      const client = {
        initialize: vi.fn().mockResolvedValue(undefined),
        request: vi.fn(),
        close: vi.fn(),
      };
      clients.push(client);
      return client;
    },
    read,
  });
  cleanup.unshift(() => service.close());
  return { service, values, snapshot, clients };
}

describe('Codex connection lifecycle', () => {
  it('checks task-opening evidence from the current index and repository, including possible and archived links', async () => {
    const fixture = await serviceFixture(async () => ({
      tasks: [
        task(),
        task({
          id: 'archived',
          archived: true,
          gitInfo: { branch: 'codex/search', sha: 'b'.repeat(40) },
        }),
      ],
      checkedAt,
      partial: false,
    }));
    const command = { repositoryId: 'atlas', branchId: 'search', taskId: 'fixture-task' };
    expect(fixture.service.isTaskLinked(command)).toBe(false);
    await fixture.service.connect();
    expect(fixture.service.isTaskLinked(command)).toBe(true);
    expect(fixture.service.isTaskLinked({ ...command, taskId: 'archived' })).toBe(true);
    for (const changed of [{ repositoryId: 'other' }, { branchId: 'other' }, { taskId: 'other' }]) {
      expect(fixture.service.isTaskLinked({ ...command, ...changed })).toBe(false);
    }
    const branch = fixture.snapshot.repositories[0].branches[0];
    branch.name = 'codex/moved';
    expect(fixture.service.isTaskLinked(command)).toBe(false);
    branch.name = 'codex/search';
    const repositories = fixture.snapshot.repositories;
    fixture.snapshot.repositories = [];
    expect(fixture.service.isTaskLinked(command)).toBe(false);
    fixture.snapshot.repositories = repositories;
    expect(fixture.service.isTaskLinked(command)).toBe(true);
    fixture.service.disconnect();
    expect(fixture.service.isTaskLinked(command)).toBe(false);
  });
  it('discards an old task refresh after stopping and re-adding project monitoring', async () => {
    let finish!: (index: CodexIndex) => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const fixture = await serviceFixture(async () => {
      if (++reads > 1) return { tasks: [task({ id: 'current-task' })], checkedAt, partial: false };
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const old = fixture.service.connect();
    await reading;
    const repositories = fixture.snapshot.repositories;
    fixture.snapshot.repositories = [];
    fixture.service.forgetUnselected();
    expect(fixture.clients[0].close).toHaveBeenCalledOnce();
    fixture.snapshot.repositories = repositories;
    await fixture.service.refresh();
    finish({ tasks: [task({ id: 'old-task' })], checkedAt, partial: false });
    await old;
    expect(fixture.values.get('codex.index')).toMatchObject({ tasks: [{ id: 'current-task' }] });
  });
  it('stores only task metadata associated with selected projects and forgets removed projects', async () => {
    const fixture = await serviceFixture(async () => ({
      tasks: [task(), task({ id: 'unrelated-private', cwd: '/unrelated', gitInfo: null })],
      checkedAt,
      partial: false,
    }));
    await fixture.service.connect();
    expect(fixture.service.status()).toMatchObject({ enabled: true, state: 'ready', taskCount: 1 });
    expect(JSON.stringify(fixture.values.get('codex.index'))).not.toContain('unrelated-private');
    expect(fixture.clients[0].close).toHaveBeenCalledOnce();
    fixture.snapshot.repositories = [];
    fixture.service.forgetUnselected();
    expect(fixture.values.get('codex.index')).toMatchObject({ tasks: [] });
  });

  it('coalesces refreshes and prevents late results from restoring disconnected data', async () => {
    let finish!: (index: CodexIndex) => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fixture = await serviceFixture(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const connect = fixture.service.connect();
    await reading;
    expect(fixture.service.refresh()).toBe(connect);
    fixture.service.disconnect();
    finish({ tasks: [task()], checkedAt, partial: false });
    await connect;
    expect(fixture.service.status()).toMatchObject({
      enabled: false,
      state: 'not-connected',
      taskCount: 0,
    });
    expect(fixture.values.get('codex.index')).toBeNull();
    expect(fixture.values.get('codex.enabled')).toBe(false);
  });

  it('keeps dated evidence after an inspection failure and clears it on disconnect', async () => {
    let fail = false;
    const fixture = await serviceFixture(async () => {
      if (fail) throw new Error('Connection stopped');
      return { tasks: [task()], checkedAt, partial: false };
    });
    await fixture.service.connect();
    fail = true;
    await fixture.service.refresh();
    expect(fixture.service.status()).toMatchObject({ state: 'error', checkedAt, taskCount: 1 });
    fixture.service.disconnect();
    expect(
      fixture.service.enrich(fixture.snapshot).repositories[0].branches[0].tasks,
    ).toBeUndefined();
  });
});
