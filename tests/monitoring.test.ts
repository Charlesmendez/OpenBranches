import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoSnapshot } from '../src/data/demo';
import type { Repository } from '../src/domain/types';
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
