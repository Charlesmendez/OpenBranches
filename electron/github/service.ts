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
import { retainPartialPulls } from '../../src/github/pulls';
import { limitSignalCache } from '../../src/github/signals';

export class GitHubService {
  private sources: Record<string, RemoteSnapshot>;
  private enabled: boolean;
  private closed = false;
  private generation = 0;
  private job?: { generation: number; promise: Promise<void> };
  private refreshOffset = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private store: Pick<AppStore, 'read' | 'write'>,
    private auth: Pick<GitHubAuth, 'http'>,
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
    this.timer = setInterval(() => {
      void this.refresh();
    }, 120_000);
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
    if (!this.enabled || this.closed) return Promise.resolve();
    if (this.job?.generation === this.generation) return this.job.promise;
    const job = { generation: this.generation, promise: Promise.resolve() };
    this.job = job;
    job.promise = this.refreshAll(job.generation).finally(() => {
      if (this.job === job) this.job = undefined;
    });
    return job.promise;
  }
  private async refreshAll(generation: number) {
    const sources = this.current().repositories.flatMap((repository) =>
      repository.remotes.map((remote) => ({ repository, remote })),
    );
    const offset = this.refreshOffset++ % Math.max(1, sources.length);
    const budget = { remaining: 12, milliseconds: 30_000 };
    const signalsBudget = { remaining: 6, milliseconds: 20_000 };
    for (const { repository, remote } of [...sources.slice(offset), ...sources.slice(0, offset)]) {
      if (this.closed || !this.enabled || generation !== this.generation) return;
      const slug = githubRepository(remote.url);
      if (!slug) continue;
      const key = `${repository.id}:${remote.name}:${slug}`;
      try {
        if (!this.selectedKeys().has(key)) continue;
        const fresh = await this.read(this.auth.http, slug, remote.name, {
          previous: this.sources[key]?.history,
          previousPulls: this.sources[key]?.pulls,
          signalsBudget,
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
        };
      }
    }
    if (!this.closed && generation === this.generation) {
      const selected = this.selectedKeys();
      this.sources = Object.fromEntries(
        Object.entries(this.sources).filter(([key]) => selected.has(key)),
      );
      this.store.write('github.sources', this.sources);
      this.publish();
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
