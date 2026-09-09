import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoSnapshot } from '../src/data/demo';
import { branchTools, taskKey, agentSearchText, isGrokModel } from '../src/domain/agents';
import { recommendationRevision } from '../src/domain/reviews';
import type { Branch, Repository, Snapshot, TaskLink } from '../src/domain/types';
import { associateTask, linkRepository } from '../electron/agents/associations';
import type { SavedAgentTask } from '../electron/agents/types';
import {
  parseClaudeMetadata,
  projectDirectoryName,
  readClaudeIndex,
  createClaudeHistorySource,
} from '../electron/claude/reader';
import { LocalHistoryService, type AgentIndex } from '../electron/agents/history';
import { AppStore } from '../electron/services/store';
import { RepositoryService } from '../electron/services/repositories';
import { stopMonitoring } from '../electron/services/monitoring';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'openbranches-agent-test-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const checkedAt = '2026-09-09T12:00:00.000Z';
function repository(path = '/fixture/atlas'): Repository {
  const original = createDemoSnapshot().repositories[0];
  return {
    ...original,
    id: 'atlas',
    path,
    commonDir: path + '/.git',
    worktrees: [],
    branches: [
      {
        ...original.branches[0],
        repositoryId: 'atlas',
        name: 'feat/session',
        tasks: [],
        worktrees: [],
      },
    ],
  };
}
const snapshot = (repositories: Repository[]): Snapshot => ({
  repositories,
  events: [],
  scanning: false,
  updatedAt: checkedAt,
});
function record(overrides: Record<string, unknown> = {}) {
  return {
    type: 'user',
    sessionId: id,
    cwd: '/fixture/atlas',
    gitBranch: 'feat/session',
    timestamp: '2026-09-09T10:00:00.000Z',
    ...overrides,
  };
}
const lines = (...records: unknown[]) =>
  records.map((record) => JSON.stringify(record)).join('\n') + '\n';
const paths = new Map([['/fixture/atlas', '/fixture/atlas']]);
const task = (overrides: Partial<SavedAgentTask> = {}): SavedAgentTask => ({
  id,
  tool: 'claude-code',
  cwd: '/fixture/atlas',
  name: 'Review search',
  updatedAt: Date.parse(checkedAt) / 1000,
  gitInfo: { branch: 'feat/session' },
  ...overrides,
});
const index = (tasks = [task()], partial = false, at = checkedAt): AgentIndex => ({
  tasks,
  partial,
  checkedAt: at,
});

describe('coding-tool attribution', () => {
  it('keeps mixed confidence visible, separates a reported model from its tool, and tolerates unknown tools', () => {
    const base: TaskLink = {
      id,
      tool: 'cursor',
      title: 'Review',
      status: 'unknown',
      association: 'possible',
    };
    const tasks: TaskLink[] = [
      { ...base, association: 'verified', model: { id: 'grok-example', provider: 'xai' } },
      { ...base, id: 'second', model: { id: 'grok-example', provider: 'xai' } },
      { ...base, id: 'future', tool: 'future-tool' as TaskLink['tool'] },
    ];
    expect(branchTools({ tasks })).toEqual([
      { tool: 'cursor', count: 2, verifiedCount: 1, modelIds: ['grok-example'], grok: true },
      { tool: 'unknown', count: 1, verifiedCount: 0, modelIds: [], grok: false },
    ]);
    expect(agentSearchText({ tasks })).toContain('Unknown tool Review');
    expect(taskKey(tasks[2])).toBe('unknown:future');
    expect(isGrokModel({ id: 'unrelated-model', provider: 'xai' })).toBe(false);
    expect(isGrokModel({ id: 'grok-example', provider: 'other' })).toBe(false);
    expect(isGrokModel({ id: 'grok-example' })).toBe(false);
  });
  it('keeps equal session IDs separate across tools and never treats a branch prefix as attribution', () => {
    const repo = repository();
    const codex = {
      ...task(),
      tool: 'codex' as const,
      gitInfo: { branch: 'feat/session', sha: repo.branches[0].local!.sha },
    };
    const linked = linkRepository(
      linkRepository(repo, [codex], checkedAt, 'codex'),
      [task()],
      checkedAt,
      'claude-code',
    );
    expect(linked.branches[0].tasks?.map(taskKey)).toEqual(['codex:' + id, 'claude-code:' + id]);
    expect(linked.branches[0].tasks?.map((task) => task.association)).toEqual([
      'verified',
      'possible',
    ]);
    expect(branchTools({ ...repo.branches[0], name: 'codex/generated' } as Branch)).toEqual([]);
    expect(
      linkRepository(linked, [], checkedAt, 'claude-code').branches[0].tasks?.map(
        (task) => task.tool,
      ),
    ).toEqual(['codex']);
    expect(
      associateTask(repo, repo.branches[0], task({ cwd: '/another/project' }), checkedAt),
    ).toBeUndefined();
  });
  it('searches actual tool and model evidence, while preserving existing Codex review revisions', () => {
    const repo = repository();
    const base: TaskLink = { id, title: 'Session', association: 'possible', status: 'unknown' };
    const branch = { ...repo.branches[0], tasks: [base] };
    const previous = recommendationRevision(repo, branch);
    expect(recommendationRevision(repo, { ...branch, tasks: [{ ...base, tool: 'codex' }] })).toBe(
      previous,
    );
    const withClaude = {
      ...branch,
      tasks: [{ ...base, tool: 'claude-code' as const, model: { id: 'claude-example' } }],
    };
    expect(recommendationRevision(repo, withClaude)).not.toBe(previous);
    expect(agentSearchText(withClaude)).toContain('Claude Code Session claude-example');
  });
});

describe('Claude session metadata', () => {
  it('retains only structural metadata and an explicit title and model, never prompts or tool contents', () => {
    const parsed = parseClaudeMetadata(
      [
        lines(
          record({ message: { content: 'PRIVATE_PROMPT' } }),
          record({ type: 'custom-title', customTitle: 'Search review' }),
          record({
            type: 'assistant',
            message: {
              model: 'claude-example',
              content: 'PRIVATE_RESULT',
              usage: { secret: 'PRIVATE_USAGE' },
            },
          }),
          record({
            type: 'queue-operation',
            content: 'PRIVATE_QUEUE',
            message: { model: 'spoofed-model' },
          }),
        ),
      ],
      id,
      paths,
    );
    expect(parsed.task).toMatchObject({
      tool: 'claude-code',
      name: 'Search review',
      model: { id: 'claude-example' },
      gitInfo: { branch: 'feat/session' },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/PRIVATE|spoofed|usage|content/);
    expect(parsed.task?.gitInfo?.sha).toBeUndefined();
    expect(parsed.task?.model?.provider).toBeUndefined();
  });
  it('clears model evidence when the session changes branch, and rejects an unselected final folder', () => {
    const old = record({ type: 'assistant', message: { model: 'old-model' } });
    const moved = parseClaudeMetadata([lines(old, record({ gitBranch: 'feat/next' }))], id, paths);
    expect(moved.task?.gitInfo?.branch).toBe('feat/next');
    expect(moved.task?.model).toBeUndefined();
    expect(
      parseClaudeMetadata([lines(old, record({ cwd: '/unselected' }))], id, paths).task,
    ).toBeUndefined();
    expect(
      parseClaudeMetadata([lines(old, record({ timestamp: '1969-12-31T23:59:59Z' }))], id, paths)
        .task,
    ).toBeUndefined();
  });
  it('ignores sidechains and foreign sessions, and requires context in the last chunk of a bounded read', () => {
    const first = lines(record());
    expect(
      parseClaudeMetadata(
        [first, lines(record({ isSidechain: true, gitBranch: 'other' }))],
        id,
        paths,
      ).task?.gitInfo?.branch,
    ).toBe('feat/session');
    expect(
      parseClaudeMetadata(
        [lines(record({ sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }))],
        id,
        paths,
      ).task,
    ).toBeUndefined();
    expect(parseClaudeMetadata([first, '{"incomplete":'], id, paths, true)).toEqual({
      partial: true,
    });
    expect(
      parseClaudeMetadata([first, lines(record({ gitBranch: 'feat/next' }))], id, paths, true).task
        ?.gitInfo?.branch,
    ).toBe('feat/next');
  });
  it('reads only matching project directories and regular session files, validates encoded-path collisions, and preserves source files', async () => {
    const root = await directory();
    const source = join(root, 'claude');
    const repo = repository(join(root, 'atlas.api'));
    const folder = join(source, 'projects', projectDirectoryName(repo.path));
    await mkdir(repo.path);
    await mkdir(folder, { recursive: true });
    const body = lines(
      record({ cwd: repo.path }),
      record({
        cwd: repo.path,
        type: 'assistant',
        message: { model: 'claude-example', content: 'PRIVATE' },
      }),
    );
    await writeFile(join(folder, id + '.jsonl'), body);
    await symlink(
      join(folder, id + '.jsonl'),
      join(folder, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl'),
    );
    const before = await readFile(join(folder, id + '.jsonl'), 'utf8');
    const found = await readClaudeIndex([repo], source);
    expect(found.tasks).toHaveLength(1);
    expect(found.tasks[0].cwd).toBe(await realpath(repo.path));
    expect(await readFile(join(folder, id + '.jsonl'), 'utf8')).toBe(before);
    expect(JSON.stringify(found)).not.toContain('PRIVATE');
    const collision = repository(repo.path.replace('atlas.api', 'atlas-api'));
    await mkdir(collision.path);
    expect(projectDirectoryName(collision.path)).toBe(projectDirectoryName(repo.path));
    expect((await readClaudeIndex([collision], source)).tasks).toEqual([]);
  });
  it('keeps the latest branch/model in a large transcript and labels bounded history', async () => {
    const root = await directory();
    const repo = repository(join(root, 'atlas'));
    await mkdir(repo.path);
    const folder = join(root, 'projects', projectDirectoryName(repo.path));
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, id + '.jsonl'),
      lines(
        record({ cwd: repo.path, type: 'custom-title', customTitle: 'Large saved session' }),
        record({ cwd: repo.path, message: { content: 'x'.repeat(400000) } }),
        record({
          cwd: repo.path,
          gitBranch: 'feat/latest',
          type: 'assistant',
          message: { model: 'latest-model' },
        }),
      ),
    );
    const result = await readClaudeIndex([repo], root);
    expect(result.partial).toBe(true);
    expect(result.tasks[0]).toMatchObject({
      name: 'Large saved session',
      gitInfo: { branch: 'feat/latest' },
      model: { id: 'latest-model' },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(readClaudeIndex([repo], root, controller.signal)).rejects.toThrow('Cancelled');
  });
  it('rotates projects after reaching the byte budget so a large first project does not starve others', async () => {
    const root = await directory();
    const first = repository(join(root, 'a'));
    const second = repository(join(root, 'b'));
    for (const repo of [first, second]) {
      await mkdir(repo.path);
      await mkdir(join(root, 'projects', projectDirectoryName(repo.path)), { recursive: true });
    }
    const folder = join(root, 'projects', projectDirectoryName(first.path));
    await Promise.all(
      Array.from({ length: 257 }, (_, index) => {
        const sessionId = index.toString(16).padStart(8, '0') + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        return writeFile(
          join(folder, sessionId + '.jsonl'),
          lines(record({ sessionId, cwd: first.path })),
        );
      }),
    );
    await writeFile(
      join(root, 'projects', projectDirectoryName(second.path), id + '.jsonl'),
      lines(record({ cwd: second.path })),
    );
    const source = createClaudeHistorySource(root);
    const secondPath = await realpath(second.path);
    const firstPass = await source.read([first, second]);
    expect(firstPass.partial).toBe(true);
    expect(firstPass.tasks.some((task) => task.cwd === secondPath)).toBe(false);
    const secondPass = await source.read([first, second]);
    expect(secondPass.tasks.some((task) => task.cwd === secondPath)).toBe(true);
  });
});

async function serviceFixture(
  read: (repositories: Repository[], signal?: AbortSignal) => Promise<AgentIndex>,
) {
  const store = new AppStore(await directory());
  cleanup.push(() => store.close());
  store.write('snapshot', snapshot([repository()]));
  const repositories = new RepositoryService(
    store,
    vi.fn(),
    { executable: async () => '/fixture/git' },
    { scan: vi.fn(async () => repository()), close: vi.fn() },
  );
  cleanup.push(() => repositories.close());
  const service = new LocalHistoryService(store, () => repositories.current(), vi.fn(), {
    tool: 'claude-code',
    read,
  });
  cleanup.push(() => service.close());
  const remove = () =>
    stopMonitoring(
      'atlas',
      repositories,
      { enrich: (value) => value, prepareForgetUnselected: () => () => {} },
      { prepareForgetUnselected: () => () => {} },
      { prepareForgetUnselected: () => () => {} },
      undefined,
      [service],
    );
  return { store, repositories, service, remove };
}
describe('local agent history lifecycle', () => {
  it('ends a stalled read and ignores its late result after the deadline', async () => {
    let finish!: (index: AgentIndex) => void;
    const f = await serviceFixture(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.useFakeTimers();
    const reading = f.service.setEnabled(true);
    await vi.advanceTimersByTimeAsync(25_001);
    await reading;
    expect(f.service.status()).toMatchObject({
      state: 'error',
      taskCount: 0,
      error: expect.stringContaining('timed out'),
    });
    finish(index());
    await Promise.resolve();
    expect(f.service.status().taskCount).toBe(0);
  });
  it('requires opt-in, scopes its cache, preserves old observation times on partial passes, and clears on disconnect', async () => {
    let fresh = index([task(), task({ id: 'unrelated', cwd: '/other' })]);
    const read = vi.fn(async () => fresh);
    const f = await serviceFixture(read);
    await f.service.refresh();
    expect(read).not.toHaveBeenCalled();
    await f.service.setEnabled(true);
    expect(f.service.status().taskCount).toBe(1);
    fresh = index([task({ id: 'new' })], true, '2026-09-09T13:00:00.000Z');
    await f.service.refresh();
    const tasks = f.service.enrich(f.repositories.current()).repositories[0].branches[0].tasks!;
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.id === id)?.checkedAt).toBe(checkedAt);
    expect(tasks.find((task) => task.id === 'new')?.checkedAt).toBe(fresh.checkedAt);
    await f.service.setEnabled(false);
    expect(f.store.read('agents.claude-code.index', 'missing')).toBeNull();
    expect(f.service.enrich(f.repositories.current()).repositories[0].branches[0].tasks).toEqual(
      [],
    );
  });
  it('retains selected cached matches after a source failure and restores them across instances', async () => {
    let failed = false;
    const f = await serviceFixture(async () => {
      if (failed) throw new Error('PRIVATE_PATH');
      return index();
    });
    await f.service.setEnabled(true);
    failed = true;
    await f.service.refresh();
    expect(f.service.status()).toMatchObject({ state: 'error', taskCount: 1, checkedAt });
    expect(JSON.stringify(f.service.status())).not.toContain('PRIVATE_PATH');
    f.service.close();
    const restored = new LocalHistoryService(f.store, () => f.repositories.current(), vi.fn(), {
      tool: 'claude-code',
      read: async () => index(),
    });
    cleanup.push(() => restored.close());
    expect(restored.status()).toMatchObject({ enabled: true, taskCount: 1 });
  });
  it.each(['disconnect', 'remove'] as const)(
    'rejects a late history result after %s',
    async (action) => {
      let finish!: (index: AgentIndex) => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const f = await serviceFixture(async () => {
        entered();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const reading = f.service.setEnabled(true);
      await started;
      if (action === 'disconnect') await f.service.setEnabled(false);
      else f.remove();
      finish(index());
      await reading;
      expect(f.service.status().taskCount).toBe(0);
      expect(
        f.service
          .enrich(f.repositories.current())
          .repositories.flatMap((repo) => repo.branches.flatMap((branch) => branch.tasks ?? [])),
      ).toEqual([]);
    },
  );
  it('rolls back project removal and preserves its history when the cache write fails', async () => {
    const f = await serviceFixture(async () => index());
    await f.service.setEnabled(true);
    const original = f.store.write.bind(f.store);
    const write = vi.spyOn(f.store, 'write').mockImplementation((key, value) => {
      if (key === 'agents.claude-code.index') throw new Error('Fixture write failed');
      original(key, value);
    });
    expect(f.remove).toThrow('Fixture write failed');
    expect(f.store.snapshot().repositories).toHaveLength(1);
    expect(f.service.status().taskCount).toBe(1);
    write.mockRestore();
    f.remove();
    expect(f.store.snapshot().repositories).toEqual([]);
    expect(f.service.status().taskCount).toBe(0);
  });
});
