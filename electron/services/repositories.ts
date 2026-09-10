import { watch, type FSWatcher } from 'node:fs';
import type { Repository, Snapshot } from '../../src/domain/types';
import { observedActivity } from '../../src/domain/activity';
import { AppStore } from './store';
import { GitWorkerClient } from '../git/client';
import type { GitInstallation } from '../git/installation';

export class RepositoryService {
  private snapshot: Snapshot;
  private worker: Pick<GitWorkerClient, 'scan' | 'close'>;
  private closed = false;
  private refreshing?: Promise<void>;
  private watchPaths = new Map<string, string>();
  private watchers = new Map<string, FSWatcher[]>();
  private debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, Promise<Repository>>();
  private revisions = new Map<string, number>();
  private reconcile: ReturnType<typeof setInterval>;
  constructor(
    private store: AppStore,
    private publish: (snapshot: Snapshot) => void,
    git: Pick<GitInstallation, 'executable'>,
    worker: Pick<GitWorkerClient, 'scan' | 'close'> = new GitWorkerClient(git),
  ) {
    this.worker = worker;
    this.snapshot = { ...store.snapshot(), scanning: false };
    this.reconcile = setInterval(() => {
      void this.refresh();
    }, 30_000);
    for (const repository of this.snapshot.repositories) this.watchRepository(repository);
  }
  current(): Snapshot {
    return this.snapshot;
  }
  add(path: string): Promise<Repository>;
  add(path: string, accept: (repository: Repository) => boolean): Promise<Repository | null>;
  async add(
    path: string,
    accept?: (repository: Repository) => boolean,
  ): Promise<Repository | null> {
    const repository = await this.scan(path);
    if (this.closed) throw new Error('Project monitoring has stopped.');
    if (accept && !accept(repository)) return null;
    // Discovery can encounter multiple saved roots for the same Git worktree
    // family. Keep the user's existing project identity and primary folder.
    if (accept) {
      const existing = this.snapshot.repositories.find((item) => item.id === repository.id);
      if (existing) return existing;
    }
    this.replace(repository);
    return repository;
  }
  remove(id: string, prepareConnections?: (next: Snapshot) => () => void): void {
    if (!this.snapshot.repositories.some((repository) => repository.id === id)) return;
    const next = {
      ...this.snapshot,
      repositories: this.snapshot.repositories.filter((repository) => repository.id !== id),
      events: this.snapshot.events.filter((event) => event.repositoryId !== id),
      updatedAt: new Date().toISOString(),
    };
    // Keep the workspace and its connection caches in one durable change.
    // Preparing a connection writes storage but does not replace its memory.
    const adoptConnections = this.store.transaction(() => {
      this.store.write('snapshot', next);
      return prepareConnections?.(next);
    });
    const removed = this.snapshot.repositories.find((repository) => repository.id === id)!;
    this.revisions.set(id, this.revision(id) + 1);
    for (const path of [removed.path, ...removed.worktrees.map((tree) => tree.path)])
      this.inFlight.delete(path);
    this.watchers.get(id)?.forEach((w) => w.close());
    this.watchers.delete(id);
    this.watchPaths.delete(id);
    const timer = this.debounces.get(id);
    if (timer) clearTimeout(timer);
    this.debounces.delete(id);
    this.snapshot = next;
    adoptConnections?.();
    this.publish(this.snapshot);
  }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshAll().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async refreshAll(): Promise<void> {
    this.snapshot.scanning = true;
    this.publish(this.snapshot);
    for (const repository of [...this.snapshot.repositories]) {
      const revision = this.revision(repository.id);
      if (!this.isCurrent(repository.id, revision)) continue;
      try {
        const fresh = await this.scan(repository.path);
        if (this.isCurrent(repository.id, revision)) this.replace(fresh);
      } catch (error) {
        const current = this.snapshot.repositories.find((r) => r.id === repository.id);
        if (current && this.isCurrent(repository.id, revision))
          current.error = error instanceof Error ? error.message : 'Repository unavailable';
      }
    }
    this.snapshot.scanning = false;
    this.emit();
  }
  private scan(path: string): Promise<Repository> {
    const existing = this.inFlight.get(path);
    if (existing) return existing;
    const promise = this.worker.scan(path).finally(() => {
      if (this.inFlight.get(path) === promise) this.inFlight.delete(path);
    });
    this.inFlight.set(path, promise);
    return promise;
  }
  private revision(id: string): number {
    return this.revisions.get(id) ?? 0;
  }
  private isCurrent(id: string, revision: number): boolean {
    return (
      !this.closed &&
      this.revision(id) === revision &&
      this.snapshot.repositories.some((repository) => repository.id === id)
    );
  }
  private replace(repository: Repository): void {
    if (this.closed) return;
    const previous = this.snapshot.repositories.find((r) => r.id === repository.id);
    if (previous) {
      const events = observedActivity(previous, repository);
      this.snapshot.events = [...events, ...this.snapshot.events].slice(0, 500);
    }
    this.snapshot.repositories = [
      ...this.snapshot.repositories.filter((r) => r.id !== repository.id),
      repository,
    ].sort((a, b) => a.name.localeCompare(b.name));
    this.watchRepository(repository);
    this.emit();
  }
  private watchRepository(repository: Repository): void {
    if (this.closed) return;
    const paths = [
      ...new Set([
        repository.commonDir,
        ...repository.worktrees.filter((w) => w.available).map((w) => w.path),
      ]),
    ].sort();
    const signature = JSON.stringify(paths);
    if (this.watchPaths.get(repository.id) === signature) return;
    this.watchPaths.set(repository.id, signature);
    this.watchers.get(repository.id)?.forEach((w) => w.close());
    const watchers: FSWatcher[] = [];
    const ignored =
      /(^|\/)(node_modules|dist|out|build|target|\.next|\.cache|coverage|\.venv)(\/|$)/;
    for (const path of paths) {
      try {
        const watcher = watch(path, { recursive: true }, (_event, filename) => {
          if (filename && ignored.test(String(filename))) return;
          const timer = this.debounces.get(repository.id);
          if (timer) clearTimeout(timer);
          this.debounces.set(
            repository.id,
            setTimeout(async () => {
              this.debounces.delete(repository.id);
              const revision = this.revision(repository.id);
              try {
                const fresh = await this.scan(repository.path);
                if (this.isCurrent(repository.id, revision)) this.replace(fresh);
              } catch {
                /* The reconciliation pass publishes availability failures. */
              }
            }, 500),
          );
        });
        watcher.on('error', () => {
          watcher.close();
          this.watchPaths.delete(repository.id);
        });
        watchers.push(watcher);
      } catch {
        /* Polling keeps repositories usable when recursive watching is unavailable. */
      }
    }
    this.watchers.set(repository.id, watchers);
  }
  private emit(): void {
    if (this.closed) return;
    this.snapshot.updatedAt = new Date().toISOString();
    this.store.write('snapshot', this.snapshot);
    this.publish(this.snapshot);
  }
  close(): void {
    this.closed = true;
    clearInterval(this.reconcile);
    this.watchers.forEach((ws) => ws.forEach((w) => w.close()));
    this.debounces.forEach(clearTimeout);
    this.worker.close();
  }
}
