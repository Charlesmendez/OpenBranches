import type { Repository, Snapshot } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import type { GitHubAuth } from './auth';
import { githubRepository, readRemote, type RemoteSnapshot } from './reader';
import { enrichRepository } from './enrich';

export class GitHubService {
  private sources: Record<string, RemoteSnapshot>;
  private enabled: boolean;
  private closed = false;
  private generation = 0;
  private refreshing?: Promise<void>;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private store: AppStore,
    private auth: GitHubAuth,
    private current: () => Snapshot,
    private publish: () => void,
  ) {
    this.sources = store.read('github.sources', {});
    this.enabled = store.read('github.enabled', false);
    this.timer = setInterval(() => {
      void this.refresh();
    }, 120_000);
  }
  isEnabled() {
    return this.enabled;
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
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshAll().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async refreshAll() {
    const generation = this.generation;
    for (const repository of this.current().repositories) {
      for (const remote of repository.remotes) {
        if (this.closed || !this.enabled || generation !== this.generation) return;
        const slug = githubRepository(remote.url);
        if (!slug) continue;
        const key = `${repository.id}:${remote.name}:${slug}`;
        try {
          const fresh = await readRemote(this.auth.http, slug, remote.name);
          if (this.closed || generation !== this.generation) return;
          this.sources[key] = fresh;
        } catch (error) {
          if (this.closed || generation !== this.generation) return;
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
    }
    if (!this.closed) {
      this.store.write('github.sources', this.sources);
      this.publish();
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
