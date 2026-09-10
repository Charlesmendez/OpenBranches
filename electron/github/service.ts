import type { Repository, Snapshot } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import type { GitHubAuth } from './auth';
import {
  githubRepository,
  readRemote,
  remoteSnapshotSchema,
  type RemoteSnapshot,
} from '../../src/github/reader';
import { enrichRepository } from './enrich';
import { readOpenPulls, reconcileOpenPulls, retainPartialPulls } from '../../src/github/pulls';
import { limitSignalCache } from '../../src/github/signals';
import { GitHubError, type GitHubReader } from '../../src/github/transport';

const PULL_REFRESH_MS = 120_000;
const PUBLIC_PULL_REFRESH_MS = 5 * 60_000;
const FULL_REFRESH_MS = 10 * 60_000;

class RefreshBudgetExhausted extends Error {}

export class GitHubService {
  private sources: Record<string, RemoteSnapshot>;
  private enabled: boolean;
  private closed = false;
  private generation = 0;
  private job?: { generation: number; promise: Promise<void> };
  private fullRequested = false;
  private refreshOffset = 0;
  private lastPullRefreshAt = 0;
  private pullTimer: ReturnType<typeof setInterval>;
  private fullTimer: ReturnType<typeof setInterval>;

  constructor(
    private store: Pick<AppStore, 'read' | 'write'>,
    private auth: Pick<GitHubAuth, 'http'> & Partial<Pick<GitHubAuth, 'status'>>,
    private current: () => Snapshot,
    private publish: () => void,
    private read: typeof readRemote = readRemote,
  ) {
    const cached = store.read<unknown>('github.sources', {});
    this.sources = Object.create(null);
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      for (const [key, value] of Object.entries(cached)) {
        const parsed = remoteSnapshotSchema.safeParse(value);
        if (parsed.success)
          this.sources[key] = { ...parsed.data, pulls: limitSignalCache(parsed.data.pulls) };
      }
    }
    this.enabled = store.read<boolean>('github.enabled', false) === true;
    this.forgetUnselected();
    // Open PR state is small and time-sensitive. Branch, closed-PR, signal and
    // history reads are substantially more expensive, so rotate them slowly.
    this.pullTimer = setInterval(() => void this.refreshPullRequests(), PULL_REFRESH_MS);
    this.fullTimer = setInterval(() => void this.refresh(), FULL_REFRESH_MS);
  }
  isEnabled() {
    return this.enabled;
  }
  private selectedKeys(snapshot = this.current()): Set<string> {
    return new Set(
      snapshot.repositories.flatMap((repository) =>
        repository.remotes.flatMap((remote) => {
          const slug = githubRepository(remote.url);
          return slug ? [`${repository.id}:${remote.name}:${slug}`] : [];
        }),
      ),
    );
  }
  forgetUnselected(): void {
    this.prepareForgetUnselected(this.current())();
  }
  prepareForgetUnselected(snapshot: Snapshot): () => void {
    const selected = this.selectedKeys(snapshot);
    const sources = Object.fromEntries(
      Object.entries(this.sources).filter(([key]) => selected.has(key)),
    );
    if (Object.keys(sources).length !== Object.keys(this.sources).length)
      this.store.write('github.sources', sources);
    return () => {
      ++this.generation;
      this.sources = sources;
    };
  }
  setEnabled(enabled: boolean) {
    ++this.generation;
    this.fullRequested = false;
    this.enabled = enabled;
    this.store.write('github.enabled', enabled);
    if (!enabled) {
      this.sources = {};
      this.store.write('github.sources', this.sources);
    }
    this.publish();
  }
  enrich(snapshot: Snapshot): Snapshot {
    if (!this.enabled) return snapshot;
    return {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) =>
        enrichRepository(repository, this.forRepository(repository)),
      ),
    };
  }
  private forRepository(repository: Repository) {
    return repository.remotes.flatMap((remote) => {
      const slug = githubRepository(remote.url);
      const source = this.sources[`${repository.id}:${remote.name}:${slug}`];
      return source ? [source] : [];
    });
  }
  refresh(): Promise<void> {
    return this.startRefresh(true);
  }
  refreshPullRequests(): Promise<void> {
    return this.startRefresh(false);
  }
  private startRefresh(full: boolean): Promise<void> {
    if (!this.enabled || this.closed) return Promise.resolve();
    if (full) this.fullRequested = true;
    if (this.job?.generation === this.generation) return this.job.promise;
    const job = { generation: this.generation, promise: Promise.resolve() };
    this.job = job;
    job.promise = this.runQueuedRefreshes(job.generation).finally(() => {
      if (this.job === job) this.job = undefined;
    });
    return job.promise;
  }
  private async runQueuedRefreshes(generation: number) {
    do {
      const full = this.fullRequested;
      this.fullRequested = false;
      await this.refreshAll(generation, full);
    } while (this.fullRequested && !this.closed && this.enabled && generation === this.generation);
  }
  private sourceKey(repository: Repository, remote: Repository['remotes'][number]) {
    const slug = githubRepository(remote.url);
    return slug ? `${repository.id}:${remote.name}:${slug}` : undefined;
  }
  private save(generation: number) {
    if (this.closed || generation !== this.generation) return;
    const selected = this.selectedKeys();
    this.sources = Object.fromEntries(
      Object.entries(this.sources).filter(([key]) => selected.has(key)),
    );
    this.store.write('github.sources', this.sources);
    this.publish();
  }
  private async refreshAll(generation: number, full: boolean) {
    const hasAuthStatus = typeof this.auth.status === 'function';
    const connected = this.auth.status?.().connected === true;
    const now = Date.now();
    if (!full && !connected && now - this.lastPullRefreshAt < PUBLIC_PULL_REFRESH_MS) return;
    this.lastPullRefreshAt = now;
    const requestBudget = {
      remaining: !hasAuthStatus
        ? Number.MAX_SAFE_INTEGER
        : connected
          ? full
            ? 100
            : 50
          : full
            ? 8
            : 1,
    };
    const http: GitHubReader = {
      get: async (path, options) => {
        if (requestBudget.remaining <= 0) throw new RefreshBudgetExhausted();
        requestBudget.remaining -= 1;
        return this.auth.http.get(path, options);
      },
    };
    const sources = this.current().repositories.flatMap((repository) =>
      repository.remotes.flatMap((remote) =>
        githubRepository(remote.url) ? [{ repository, remote }] : [],
      ),
    );
    const verifiedPulls = new Set<string>();
    const freshOpenPulls = new Map<string, Awaited<ReturnType<typeof readOpenPulls>>>();
    let pullStatesChanged = false;
    const pullSources = sources
      .flatMap(({ repository, remote }) => {
        const slug = githubRepository(remote.url);
        const key = this.sourceKey(repository, remote);
        const source = key ? this.sources[key] : undefined;
        if (!slug || !key) return [];
        if (!hasAuthStatus && !source?.pulls.some((pull) => pull.state === 'open')) return [];
        return [
          {
            repository,
            remote,
            slug,
            key,
            source:
              source ??
              ({
                repository: slug,
                remoteName: remote.name,
                branches: [],
                pulls: [],
                checkedAt: '',
                branchesComplete: false,
                pullHistoryComplete: false,
              } satisfies RemoteSnapshot),
          },
        ];
      })
      .sort(
        (left, right) =>
          Number(right.source.pulls.some((pull) => pull.state === 'open')) -
            Number(left.source.pulls.some((pull) => pull.state === 'open')) ||
          (left.source.pullsCheckedAt || left.source.checkedAt).localeCompare(
            right.source.pullsCheckedAt || right.source.checkedAt,
          ),
      );
    const pullLimit = hasAuthStatus && !connected ? 1 : pullSources.length;
    const prioritizedPullSources = pullSources.slice(0, pullLimit);
    for (const { slug, key, source } of prioritizedPullSources) {
      if (this.closed || !this.enabled || generation !== this.generation) return;
      if (!this.selectedKeys().has(key)) continue;
      try {
        const fresh = await readOpenPulls(
          http,
          slug,
          () =>
            !this.closed &&
            this.enabled &&
            generation === this.generation &&
            this.selectedKeys().has(key),
          source,
        );
        if (this.closed || generation !== this.generation) return;
        if (!this.selectedKeys().has(key)) continue;
        this.sources[key] = reconcileOpenPulls(source, fresh);
        freshOpenPulls.set(key, fresh);
        verifiedPulls.add(key);
        pullStatesChanged = true;
      } catch (error) {
        if (this.closed || generation !== this.generation) return;
        if (!this.selectedKeys().has(key)) continue;
        if (error instanceof RefreshBudgetExhausted) break;
        const message =
          error instanceof Error ? error.message : 'GitHub could not refresh pull requests.';
        this.sources[key] = {
          ...source,
          checkedAt: source.checkedAt || new Date(now).toISOString(),
          pullsError: message,
        };
        pullStatesChanged = true;
        if (error instanceof GitHubError && error.status === 429) break;
      }
    }
    // Publish this focused result before slower branch and history reads. A
    // closed PR should disappear from the live panel as soon as GitHub proves it.
    if (pullStatesChanged) this.save(generation);
    if (!full) return;

    const sourceLimit = !hasAuthStatus ? sources.length : connected ? 8 : 1;
    const offset = this.refreshOffset % Math.max(1, sources.length);
    const rotated = [...sources.slice(offset), ...sources.slice(0, offset)].slice(0, sourceLimit);
    this.refreshOffset = (offset + rotated.length) % Math.max(1, sources.length);
    const budget = { remaining: connected || !hasAuthStatus ? 12 : 1, milliseconds: 30_000 };
    const pullLookupBudget = {
      remaining: connected || !hasAuthStatus ? 6 : 1,
      milliseconds: 15_000,
    };
    const signalsBudget = {
      remaining: connected || !hasAuthStatus ? 6 : 1,
      milliseconds: 20_000,
    };
    for (const { repository, remote } of rotated) {
      if (this.closed || !this.enabled || generation !== this.generation) return;
      const slug = githubRepository(remote.url);
      if (!slug) continue;
      const key = `${repository.id}:${remote.name}:${slug}`;
      try {
        if (!this.selectedKeys().has(key)) continue;
        const fresh = await this.read(http, slug, remote.name, {
          previous: this.sources[key]?.history,
          previousPulls: this.sources[key]?.pulls,
          previousPullLookups: this.sources[key]?.pullLookups,
          pullLookupBudget,
          signalsBudget,
          openPullSnapshot: freshOpenPulls.get(key),
          local: repository,
          budget,
          isCurrent: () =>
            !this.closed &&
            this.enabled &&
            generation === this.generation &&
            this.selectedKeys().has(key),
        });
        if (this.closed || generation !== this.generation) return;
        if (!this.selectedKeys().has(key)) continue;
        const retained = retainPartialPulls(fresh, this.sources[key]);
        this.sources[key] = { ...retained, pulls: limitSignalCache(retained.pulls) };
      } catch (error) {
        if (this.closed || generation !== this.generation) return;
        if (!this.selectedKeys().has(key)) continue;
        if (error instanceof RefreshBudgetExhausted) break;
        const previous = this.sources[key] ?? {
          repository: slug,
          remoteName: remote.name,
          branches: [],
          pulls: [],
          checkedAt: '',
          branchesComplete: false,
          pullHistoryComplete: false,
        };
        this.sources[key] = {
          ...previous,
          error: error instanceof Error ? error.message : 'GitHub could not refresh this source.',
          pullsError: verifiedPulls.has(key)
            ? previous.pullsError
            : error instanceof Error
              ? error.message
              : 'GitHub could not refresh pull requests.',
        };
        if (error instanceof GitHubError && error.status === 429) break;
      }
    }
    this.save(generation);
  }
  close() {
    this.closed = true;
    clearInterval(this.pullTimer);
    clearInterval(this.fullTimer);
  }
}
