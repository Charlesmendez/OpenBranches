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
import { readRemote, remoteSnapshotSchema, type RemoteSnapshot } from '../src/github/reader';
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
  it('reuses GitHub enrichment until the repository or its remote observations change', async () => {
    const { store } = await storeFixture();
    let snapshot = createDemoSnapshot();
    snapshot = { ...snapshot, repositories: snapshot.repositories.slice(0, 2) };
    const repo = snapshot.repositories[0];
    const key = `${repo.id}:origin:example/atlas-api`;
    store.write('github.enabled', true);
    store.write('github.sources', { [key]: remote('cached') });
    const read = vi.fn(async () => remote('updated'));
    const service = new GitHubService(
      store,
      {
        http: new GitHubHttp(
          async () => undefined,
          async () => new Response('[]'),
        ),
      },
      () => snapshot,
      () => {},
      read,
    );
    cleanup.push(() => service.close());
    const first = service.enrich(snapshot);
    const repeated = service.enrich({ ...snapshot, scanning: true });
    expect(repeated.scanning).toBe(true);
    expect(repeated.repositories[0]).toBe(first.repositories[0]);
    expect(repeated.repositories[1]).toBe(first.repositories[1]);
    snapshot = {
      ...snapshot,
      repositories: [{ ...repo, scannedAt: '2026-09-23T12:00:00Z' }, snapshot.repositories[1]],
    };
    const scanned = service.enrich(snapshot);
    expect(scanned.repositories[0]).not.toBe(first.repositories[0]);
    expect(scanned.repositories[0].scannedAt).toBe('2026-09-23T12:00:00Z');
    expect(scanned.repositories[1]).toBe(first.repositories[1]);
    await service.refresh();
    const refreshed = service.enrich(snapshot);
    expect(refreshed.repositories[0]).not.toBe(scanned.repositories[0]);
    expect(
      refreshed.repositories[0].branches.find((branch) => branch.name === 'fixture')?.remote?.sha,
    ).toBe('updated');
    expect(
      first.repositories[0].branches.find((branch) => branch.name === 'fixture')?.remote?.sha,
    ).toBe('cached');
    service.setEnabled(false);
    expect(service.enrich(snapshot)).toBe(snapshot);
    service.setEnabled(true);
    expect(
      service.enrich(snapshot).repositories[0].branches.some((branch) => branch.name === 'fixture'),
    ).toBe(false);
  });

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
  it('limits public background polling to one PR source and skips expensive full scans', async () => {
    vi.useFakeTimers();
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [0, 1, 2].map((index) => ({
      ...structuredClone(snapshot.repositories[0]),
      id: `project-${index}`,
      name: `Project ${index}`,
      remotes: [{ name: 'origin', url: `https://github.com/example/project-${index}` }],
    }));
    store.write('github.enabled', true);
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('[]'));
    const read = vi.fn<typeof readRemote>();
    const service = new GitHubService(
      store,
      {
        http: new GitHubHttp(async () => undefined, request),
        status: () => ({ connected: false, configured: true }),
      },
      () => snapshot,
      () => {},
      read,
    );
    cleanup.push(() => service.close());

    await vi.advanceTimersByTimeAsync(8 * 60_000);

    expect(request).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([input]) => new URL(String(input)).pathname).sort()).toEqual([
      '/repos/example/project-0/pulls',
      '/repos/example/project-1/pulls',
    ]);
  });
  it('caps a public full refresh even when GitHub advertises unbounded pages', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    store.write('github.enabled', true);
    const request = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response('[]', {
          headers: {
            link: '<https://api.github.com/repos/example/project/pulls?page=2>; rel="next"',
          },
        }),
    );
    const service = new GitHubService(
      store,
      {
        http: new GitHubHttp(async () => undefined, request),
        status: () => ({ connected: false, configured: true }),
      },
      () => snapshot,
      () => {},
    );
    cleanup.push(() => service.close());

    await service.refresh();

    expect(request).toHaveBeenCalledTimes(8);
  });
  it('keeps a valid partial source when a first public PR check fails', async () => {
    vi.useFakeTimers();
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    snapshot.repositories = [snapshot.repositories[0]];
    store.write('github.enabled', true);
    const service = new GitHubService(
      store,
      {
        http: new GitHubHttp(
          async () => undefined,
          vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })),
        ),
        status: () => ({ connected: false, configured: true }),
      },
      () => snapshot,
      () => {},
    );
    cleanup.push(() => service.close());

    await vi.advanceTimersByTimeAsync(2 * 60_000);

    const cached = Object.values(store.read<Record<string, unknown>>('github.sources', {}));
    expect(cached).toHaveLength(1);
    expect(remoteSnapshotSchema.safeParse(cached[0]).success).toBe(true);
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
  async function watchFixture(scan?: (path: string) => Promise<Repository>) {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    const repo = snapshot.repositories[0];
    repo.path = '/fixture/primary';
    repo.commonDir = '/fixture/shared.git';
    repo.worktrees = [checkout(repo.path, repo.branches[0].local!.fullName, 'a'.repeat(40))];
    store.write('snapshot', { ...snapshot, repositories: [repo] });
    const workerScan =
      scan ?? vi.fn(async () => ({ ...repo, scannedAt: new Date().toISOString() }));
    const watcher = watcherFixture();
    const publish = vi.fn();
    const service = new RepositoryService(
      store,
      publish,
      { executable: async () => '/fixture/git' },
      { scan: workerScan, close() {} },
      watcher.factory,
    );
    cleanup.push(() => service.close());
    const change = () =>
      watcher.watchers.filter((w) => !w.closed)[0].change('change', 'src/file.ts');
    const gitChange = (filename: string) =>
      watcher.watchers
        .find((w) => !w.closed && w.path === repo.commonDir)!
        .change('change', filename);
    return { service, scan: workerScan, publish, repo, change, gitChange };
  }

  it.each(['HEAD', 'refs/heads/main', 'packed-refs', 'worktrees/linked/HEAD', 'config'])(
    'keeps Git metadata changes prompt during a working-file cooldown: %s',
    async (filename) => {
      vi.useFakeTimers();
      const fixture = await watchFixture();
      await fixture.service.refresh();
      fixture.change();
      await vi.advanceTimersByTimeAsync(1000);
      fixture.gitChange(filename);
      await vi.advanceTimersByTimeAsync(499);
      expect(fixture.scan).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.scan).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fixture.scan).toHaveBeenCalledTimes(2);
    },
  );

  it('does not treat temporary Git lock files as checkout or ref changes', async () => {
    vi.useFakeTimers();
    const fixture = await watchFixture();
    await fixture.service.refresh();
    fixture.gitChange('HEAD.lock');
    fixture.gitChange('refs/heads/main.lock');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.scan).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fixture.scan).toHaveBeenCalledTimes(2);
  });

  it('bounds continuous file writes without starving scans and consumes the final trailing change', async () => {
    vi.useFakeTimers();
    const fixture = await watchFixture();
    for (let i = 0; i < 600; i++) {
      fixture.change();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(fixture.scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.scan).toHaveBeenCalledTimes(3);
    expect(fixture.publish).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.scan).toHaveBeenCalledTimes(3);
  });

  it('coalesces separated editor bursts instead of rescanning the project each second', async () => {
    vi.useFakeTimers();
    const fixture = await watchFixture();
    for (let i = 0; i < 60; i++) {
      fixture.change();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fixture.scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.scan).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.scan).toHaveBeenCalledTimes(3);
  });

  it('keeps edits received during a slow scan for exactly one trailing scan', async () => {
    vi.useFakeTimers();
    const pending = deferred<Repository>();
    const scan = vi.fn().mockReturnValueOnce(pending.promise);
    const fixture = await watchFixture(scan);
    scan.mockResolvedValue({ ...fixture.repo, name: 'latest' });
    fixture.change();
    await vi.advanceTimersByTimeAsync(500);
    fixture.change();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(scan).toHaveBeenCalledOnce();
    pending.resolve(fixture.repo);
    await vi.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(fixture.service.current().repositories[0].name).toBe('latest');
    expect(fixture.publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('lets manual refresh bypass the cooldown and consume already queued edits', async () => {
    vi.useFakeTimers();
    const fixture = await watchFixture();
    await fixture.service.refresh();
    fixture.change();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.scan).toHaveBeenCalledOnce();
    await fixture.service.refresh();
    expect(fixture.scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.scan).toHaveBeenCalledTimes(2);
  });

  it('does not republish an in-flight manual scan and retains edits received during it', async () => {
    vi.useFakeTimers();
    const pending = deferred<Repository>();
    const scan = vi.fn().mockReturnValueOnce(pending.promise);
    const fixture = await watchFixture(scan);
    scan.mockResolvedValue(fixture.repo);
    const work = fixture.service.refresh();
    fixture.change();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(scan).toHaveBeenCalledOnce();
    pending.resolve(fixture.repo);
    await work;
    expect(fixture.publish).toHaveBeenCalledTimes(2); // scanning start and finish
    await vi.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(fixture.publish).toHaveBeenCalledTimes(3);
  });

  it('cancels queued scans on suspension and shutdown', async () => {
    vi.useFakeTimers();
    const fixture = await watchFixture();
    await fixture.service.refresh();
    fixture.change();
    fixture.service.setSuspended(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.scan).toHaveBeenCalledOnce();
    fixture.service.setSuspended(false);
    fixture.change();
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.scan).toHaveBeenCalledTimes(2);
    fixture.change();
    fixture.service.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.scan).toHaveBeenCalledTimes(2);
  });

  it('does not let a removed monitoring session overwrite or block a newly added one', async () => {
    vi.useFakeTimers();
    const pending = deferred<Repository>();
    const scan = vi.fn().mockReturnValueOnce(pending.promise);
    const fixture = await watchFixture(scan);
    const fresh = { ...fixture.repo, name: 'new session' };
    scan.mockResolvedValue(fresh);
    fixture.change();
    await vi.advanceTimersByTimeAsync(500);
    fixture.service.remove(fixture.repo.id);
    await fixture.service.add(fixture.repo.path);
    fixture.change();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(3);
    pending.resolve(fixture.repo);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.service.current().repositories[0].name).toBe('new session');
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('batches a full reconciliation into one durable workspace update', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    const repositories = snapshot.repositories.slice(0, 2).map((repository, index) => ({
      ...structuredClone(repository),
      path: `/fixture/repository-${index}`,
    }));
    store.write('snapshot', { ...snapshot, repositories });
    const scan = vi.fn(async (path: string) =>
      structuredClone(repositories.find((repository) => repository.path === path)!),
    );
    const scanningStates: boolean[] = [];
    const write = vi.spyOn(store, 'write');
    const release = vi.fn();
    const service = new RepositoryService(
      store,
      (current) => scanningStates.push(current.scanning),
      { executable: async () => '/fixture/git' },
      { scan, close: () => {}, release },
      watcherFixture().factory,
    );
    cleanup.push(() => service.close());

    await service.refresh();

    expect(scan).toHaveBeenCalledTimes(repositories.length);
    expect(scanningStates).toEqual([true, false]);
    expect(write).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('closes watchers and stops reconciliation while suspended, then restores both', async () => {
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
    cleanup.push(() => service.close());

    expect(watcher.watchers).toHaveLength(2);
    service.setSuspended(true);
    expect(watcher.watchers.every(({ closed }) => closed)).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scan).not.toHaveBeenCalled();

    service.setSuspended(false);
    expect(watcher.watchers).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scan).toHaveBeenCalledOnce();
  });

  it('stops a running batch after the current repository when hidden and preserves prior observations', async () => {
    const { store } = await storeFixture();
    const snapshot = createDemoSnapshot();
    store.write('snapshot', snapshot);
    const pending = deferred<Repository>();
    const scan = vi.fn(() => pending.promise);
    const release = vi.fn();
    const service = new RepositoryService(
      store,
      () => {},
      { executable: async () => '/fixture/git' },
      { scan, close() {}, release },
      watcherFixture().factory,
    );
    cleanup.push(() => service.close());
    const before = service.current();
    const work = service.refresh();
    expect(before.scanning).toBe(false);
    expect(service.current().scanning).toBe(true);
    service.setSuspended(true);
    pending.resolve({ ...snapshot.repositories[0], scannedAt: new Date().toISOString() });
    await work;
    await service.refresh();
    expect(scan).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(service.current().scanning).toBe(false);
    expect(before.repositories[0].scannedAt).toBe(snapshot.repositories[0].scannedAt);
    expect(before).not.toBe(service.current());
  });

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
