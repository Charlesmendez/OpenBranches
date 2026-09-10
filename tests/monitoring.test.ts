import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import type { FSWatcher, watch as watchType } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoSnapshot } from '../src/data/demo';
import type { Repository, Worktree } from '../src/domain/types';
import { AppStore } from '../electron/services/store';
import { RepositoryService } from '../electron/services/repositories';
import { GitHubService } from '../electron/github/service';
import { GitHubHttp } from '../electron/github/http';
import type { RemoteSnapshot } from '../src/github/reader';
import { CodexService } from '../electron/codex/service';
import { ReviewService } from '../electron/services/reviews';
import { stopMonitoring } from '../electron/services/monitoring';
import { recommendationsFor } from '../src/domain/branches';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'openbranches-monitoring-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new AppStore(join(directory, 'state'));
  cleanup.push(() => store.close());
  return { store, directory };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class FakeWatcher {
  private error?: () => void;
  closed = false;
  constructor(
    readonly path: string,
    readonly change: (event: string, filename: string | null) => void,
  ) {}
  on(event: string, listener: () => void) {
    if (event === 'error') this.error = listener;
    return this;
  }
  close() {
    this.closed = true;
  }
  fail() {
    this.error?.();
  }
}
function watcherFixture() {
  const watchers: FakeWatcher[] = [];
  const factory = ((
    path: string,
    _options: { recursive: boolean },
    listener: (event: string, filename: string | null) => void,
  ) => {
    const watcher = new FakeWatcher(path, listener);
    watchers.push(watcher);
    return watcher as unknown as FSWatcher;
  }) as typeof watchType;
  return { factory, watchers };
}
const checkout = (path: string, branch: string, head: string, available = true): Worktree => ({
  path,
  branch,
  head,
  available,
  detached: false,
  dirty: available ? false : null,
  changedFiles: available ? 0 : null,
});
const remote = (sha: string): RemoteSnapshot => ({
  repository: 'example/atlas-api',
  remoteName: 'origin',
  branches: [{ name: 'fixture', sha }],
  pulls: [],
  checkedAt: new Date().toISOString(),
  branchesComplete: true,
  pullHistoryComplete: true,
});

describe('stopping project monitoring', () => {
  it.each([null, [], { broken: { branches: null } }])(
    'ignores malformed GitHub cache data: %j',
    async (cached) => {
      const { store } = await storeFixture();
      const snapshot = createDemoSnapshot();
      store.write('github.enabled', true);
      store.write('github.sources', cached);
      const service = new GitHubService(
        store,
        { http: new GitHubHttp(async () => undefined) },
        () => snapshot,
        () => {},
      );
      cleanup.push(() => service.close());
      expect(service.enrich(snapshot)).toEqual(snapshot);
    },
  );
  it('rolls back every connection and keeps monitoring if the final cache write fails, then allows a complete retry', async () => {
    const { store, directory } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    const repo = snapshot.repositories[0];
    const key = `${repo.id}:origin:example/atlas-api`;
    store.write('snapshot', snapshot);
    store.write('github.enabled', true);
    store.write('github.sources', { [key]: remote('cached') });
    const index = {
      tasks: [
        {
          id: 'fixture-task',
          name: 'Fixture task',
          cwd: repo.path,
          createdAt: 1,
          updatedAt: 1,
          archived: false,
          gitInfo: { branch: repo.branches[0].name, sha: repo.branches[0].local!.sha },
        },
      ],
      checkedAt: new Date().toISOString(),
      partial: false,
    };
    store.write('codex.enabled', true);
    store.write('codex.index', index);
    const publish = vi.fn();
    const repositories = new RepositoryService(
      store,
      publish,
      { executable: async () => '/fixture/git' },
      { scan: async () => repo, close: () => {} },
    );
    cleanup.push(() => repositories.close());
    const github = new GitHubService(
      store,
      { http: new GitHubHttp(async () => undefined) },
      () => repositories.current(),
      () => {},
    );
    cleanup.push(() => github.close());
    const codex = new CodexService(
      store,
      directory,
      () => github.enrich(repositories.current()),
      () => {},
    );
    cleanup.push(() => codex.close());
    const current = () => codex.enrich(github.enrich(repositories.current()));
    const reviews = new ReviewService(store, current, () => {});
    const item = recommendationsFor(current().repositories[0])[0];
    expect(reviews.decide({ id: item.id, revision: item.revision, choice: 'dismissed' }).ok).toBe(
      true,
    );
    expect(codex.status().taskCount).toBe(1);
    const before = ['snapshot', 'github.sources', 'codex.index', 'reviews.ledger'].map((key) =>
      store.readStrict(key),
    );
    const write = store.write.bind(store);
    const failure = vi.spyOn(store, 'write').mockImplementation((key, value) => {
      if (key === 'reviews.ledger') throw new Error('storage failure');
      write(key, value);
    });
    expect(() => stopMonitoring(repo.id, repositories, github, codex, reviews)).toThrow(
      'storage failure',
    );
    expect(
      ['snapshot', 'github.sources', 'codex.index', 'reviews.ledger'].map((key) =>
        store.readStrict(key),
      ),
    ).toEqual(before);
    expect(repositories.current().repositories).toHaveLength(1);
    expect(
      github
        .enrich(repositories.current())
        .repositories[0].branches.some((branch) => branch.name === 'fixture'),
    ).toBe(true);
    expect(codex.status().taskCount).toBe(1);
    expect(reviews.currentState().decisions).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    failure.mockRestore();
    stopMonitoring(repo.id, repositories, github, codex, reviews);
    expect(repositories.current().repositories).toEqual([]);
    expect(store.snapshot().repositories).toEqual([]);
    expect(store.readStrict('github.sources')).toEqual({});
    expect(store.readStrict('codex.index')).toMatchObject({ tasks: [] });
    expect(store.readStrict('reviews.ledger')).toEqual({ version: 1, decisions: [] });
    expect(codex.status().taskCount).toBe(0);
    expect(reviews.currentState().decisions).toEqual([]);
    expect(publish).toHaveBeenCalledOnce();
  });
  it('starts a fresh local scan after re-adding and discards the previous monitoring session’s late result', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    const repo = snapshot.repositories[0];
    store.write('snapshot', snapshot);
    const pending = deferred<Repository>();
    const fresh = structuredClone(repo);
    fresh.branches[0].local!.sha = 'b'.repeat(40);
    const scan = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fresh);
    const service = new RepositoryService(
      store,
      () => {},
      { executable: async () => '/fixture/git' },
      { scan, close: () => {} },
    );
    cleanup.push(() => service.close());
    const old = service.refresh();
    service.remove(repo.id);
    await service.add(repo.path);
    pending.resolve(repo);
    await old;
    expect(scan).toHaveBeenCalledTimes(2);
    expect(service.current().repositories[0].branches[0].local?.sha).toBe('b'.repeat(40));
    expect(store.snapshot().repositories[0].branches[0].local?.sha).toBe('b'.repeat(40));
  });
  it('removes cached metadata and prevents a late GitHub result from restoring it, even after re-adding', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    const repo = snapshot.repositories[0];
    const key = `${repo.id}:origin:example/atlas-api`;
    store.write('github.enabled', true);
    store.write('github.sources', {
      [key]: remote('old'),
      'removed:origin:example/other': remote('unselected'),
    });
    const pending = deferred<RemoteSnapshot>();
    const read = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(remote('current'));
    const service = new GitHubService(
      store,
      { http: new GitHubHttp(async () => undefined) },
      () => snapshot,
      () => {},
      read,
    );
    cleanup.push(() => service.close());
    expect(Object.keys(store.read('github.sources', {}))).toEqual([key]);
    const old = service.refresh();
    snapshot.repositories = [];
    service.forgetUnselected();
    expect(store.read('github.sources', {})).toEqual({});
    snapshot.repositories = [repo];
    await service.refresh();
    pending.resolve(remote('late'));
    await old;
    expect(
      store.read<Record<string, RemoteSnapshot>>('github.sources', {})[key].branches[0].sha,
    ).toBe('current');
  });
  it('also ignores late failures and changed remote addresses', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    store.write('github.enabled', true);
    const pending = deferred<RemoteSnapshot>();
    const service = new GitHubService(
      store,
      { http: new GitHubHttp(async () => undefined) },
      () => snapshot,
      () => {},
      () => pending.promise,
    );
    cleanup.push(() => service.close());
    const work = service.refresh();
    snapshot.repositories[0].remotes = [
      { name: 'origin', url: 'https://github.com/example/new-source' },
    ];
    pending.reject(new Error('late failure'));
    await work;
    expect(store.read('github.sources', {})).toEqual({});
  });
  it('publishes closed PR removals before a slower full GitHub refresh fails', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    const repo = snapshot.repositories[0];
    const key = `${repo.id}:origin:example/atlas-api`;
    store.write('github.enabled', true);
    store.write('github.sources', {
      [key]: {
        ...remote('old'),
        pulls: [
          {
            number: 12,
            title: 'Close me',
            url: 'https://github.com/example/atlas-api/pull/12',
            state: 'open',
            base: 'main',
            headSha: 'a'.repeat(40),
            updatedAt: '2026-09-09T12:00:00Z',
            headName: 'feat/closed-now',
            headRepository: 'example/atlas-api',
            retained: true,
          },
        ],
        openPullsComplete: false,
        pullHistoryComplete: false,
        error: 'Previous refresh failed.',
      },
    });
    const publish = vi.fn();
    const service = new GitHubService(
      store,
      {
        http: new GitHubHttp(
          async () => undefined,
          vi.fn<typeof fetch>().mockResolvedValue(new Response('[]')),
        ),
      },
      () => snapshot,
      publish,
      vi.fn().mockRejectedValue(new Error('Full refresh failed.')),
    );
    cleanup.push(() => service.close());

    await service.refresh();

    const saved = store.read<Record<string, RemoteSnapshot>>('github.sources', {})[key];
    expect(saved.pulls).toEqual([]);
    expect(saved.openPullsComplete).toBe(true);
    expect(saved.pullsError).toBeUndefined();
    expect(saved.error).toBe('Full refresh failed.');
    expect(service.enrich(snapshot).repositories[0].github?.openPullsComplete).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect a repository after a pending local scan and never touches its files', async () => {
    vi.useFakeTimers();
    const { store, directory } = await storeFixture();
    const snapshot = createDemoSnapshot();
    const repo = snapshot.repositories[0];
    repo.path = join(directory, 'project');
    repo.commonDir = join(repo.path, '.git');
    repo.worktrees = [];
    await mkdir(repo.commonDir, { recursive: true });
    await writeFile(join(repo.path, 'notes.txt'), 'uncommitted work');
    await writeFile(join(repo.commonDir, 'HEAD'), 'ref: refs/heads/feature\n');
    snapshot.repositories = [repo];
    store.write('snapshot', snapshot);
    const pending = deferred<Repository>();
    const scan = vi.fn(() => pending.promise);
    const service = new RepositoryService(
      store,
      () => {},
      { executable: async () => '/fixture/git' },
      { scan, close: () => {} },
    );
    cleanup.push(() => service.close());
    const work = service.refresh();
    service.remove(repo.id);
    pending.resolve(repo);
    await work;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(service.current().repositories).toEqual([]);
    expect(store.snapshot().repositories).toEqual([]);
    expect(store.snapshot().events.every((event) => event.repositoryId !== repo.id)).toBe(true);
    expect(await readFile(join(repo.path, 'notes.txt'), 'utf8')).toBe('uncommitted work');
    expect(await readFile(join(repo.commonDir, 'HEAD'), 'utf8')).toBe('ref: refs/heads/feature\n');
  });
  it('keeps monitoring when the removal choice cannot be persisted', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    store.write('snapshot', snapshot);
    const service = new RepositoryService(
      store,
      () => {},
      { executable: async () => '/fixture/git' },
      { scan: async () => snapshot.repositories[0], close: () => {} },
    );
    cleanup.push(() => service.close());
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('storage failure');
    });
    expect(() => service.remove(snapshot.repositories[0].id)).toThrow('storage failure');
    expect(service.current().repositories).toHaveLength(1);
    expect(store.snapshot().repositories).toHaveLength(1);
  });
});

describe('live repository monitoring', () => {
  it('watches Git and every available checkout, coalesces bursts, and ignores generated folders', async () => {
    vi.useFakeTimers();
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    const repo = structuredClone(snapshot.repositories[0]);
    repo.commonDir = '/fixture/shared.git';
    repo.path = '/fixture/primary';
    repo.worktrees = [
      checkout(repo.path, repo.branches[0].local!.fullName, 'a'.repeat(40)),
      checkout('/fixture/linked', repo.branches[1].local!.fullName, 'b'.repeat(40)),
      checkout('/fixture/missing', repo.branches[2].local!.fullName, 'c'.repeat(40), false),
    ];
    store.write('snapshot', { ...snapshot, repositories: [repo] });
    const fresh = structuredClone(repo);
    fresh.branches[0].local!.sha = 'd'.repeat(40);
    const scan = vi.fn(async () => fresh);
    const publish = vi.fn();
    const watcher = watcherFixture();
    const service = new RepositoryService(
      store,
      publish,
      { executable: async () => '/fixture/git' },
      { scan, close: () => {} },
      watcher.factory,
    );
    cleanup.push(() => service.close());

    expect(watcher.watchers.map(({ path }) => path)).toEqual([
      '/fixture/linked',
      '/fixture/primary',
      '/fixture/shared.git',
    ]);
    watcher.watchers[0].change('change', 'node_modules/library/index.js');
    await vi.advanceTimersByTimeAsync(600);
    expect(scan).not.toHaveBeenCalled();

    watcher.watchers[0].change('change', 'src/first.ts');
    watcher.watchers[1].change('change', 'src/second.ts');
    await vi.advanceTimersByTimeAsync(499);
    expect(scan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(scan).toHaveBeenCalledOnce();
    expect(service.current().repositories[0].branches[0].local?.sha).toBe('d'.repeat(40));
    expect(publish).toHaveBeenCalledOnce();
  });

  it('rebuilds every watcher after one fails and closes them all on shutdown', async () => {
    vi.useFakeTimers();
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    const repo = structuredClone(snapshot.repositories[0]);
    repo.commonDir = '/fixture/shared.git';
    repo.path = '/fixture/primary';
    repo.worktrees = [checkout(repo.path, repo.branches[0].local!.fullName, 'a'.repeat(40))];
    store.write('snapshot', { ...snapshot, repositories: [repo] });
    const watcher = watcherFixture();
    const scan = vi.fn(async () => structuredClone(repo));
    const service = new RepositoryService(
      store,
      () => {},
      { executable: async () => '/fixture/git' },
      { scan, close: () => {} },
      watcher.factory,
    );

    expect(watcher.watchers).toHaveLength(2);
    watcher.watchers[0].fail();
    expect(watcher.watchers[0].closed).toBe(true);
    await service.refresh();
    expect(watcher.watchers).toHaveLength(4);
    expect(watcher.watchers.slice(0, 2).every(({ closed }) => closed)).toBe(true);

    watcher.watchers[2].change('change', 'src/after-close.ts');
    service.close();
    await vi.advanceTimersByTimeAsync(600);
    expect(watcher.watchers.every(({ closed }) => closed)).toBe(true);
    expect(scan).toHaveBeenCalledOnce();
  });
});
