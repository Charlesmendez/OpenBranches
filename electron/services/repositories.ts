import { watch, type FSWatcher } from 'node:fs';
import type { ActivityEvent, Repository, Snapshot } from '../../src/domain/types';
import { AppStore } from './store';
import { GitWorkerClient } from '../git/client';

export class RepositoryService {
  private snapshot: Snapshot;
  private worker = new GitWorkerClient();
  private closed = false;
  private refreshing?: Promise<void>;
  private watchPaths = new Map<string, string>();
  private watchers = new Map<string, FSWatcher[]>();
  private debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, Promise<Repository>>();
  private reconcile: ReturnType<typeof setInterval>;
  constructor(
    private store: AppStore,
    private publish: (snapshot: Snapshot) => void,
  ) {
    this.snapshot = { ...store.snapshot(), scanning: false };
    this.reconcile = setInterval(() => {
      void this.refresh();
    }, 30_000);
    for (const repository of this.snapshot.repositories) this.watchRepository(repository);
  }
  current(): Snapshot {
    return this.snapshot;
  }
  async add(path: string): Promise<Repository> {
    const repository = await this.scan(path);
    this.replace(repository);
    return repository;
  }
  remove(id: string): void {
    this.watchers.get(id)?.forEach((w) => w.close());
    this.watchers.delete(id);
    this.watchPaths.delete(id);
    const timer = this.debounces.get(id);
    if (timer) clearTimeout(timer);
    this.debounces.delete(id);
    this.snapshot.repositories = this.snapshot.repositories.filter((r) => r.id !== id);
    this.snapshot.events = this.snapshot.events.filter((e) => e.repositoryId !== id);
    this.emit();
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
      try {
        const fresh = await this.scan(repository.path);
        if (this.snapshot.repositories.some((r) => r.id === repository.id)) this.replace(fresh);
      } catch (error) {
        const current = this.snapshot.repositories.find((r) => r.id === repository.id);
        if (current)
          current.error = error instanceof Error ? error.message : 'Repository unavailable';
      }
    }
    this.snapshot.scanning = false;
    this.emit();
  }
  private scan(path: string): Promise<Repository> {
    const existing = this.inFlight.get(path);
    if (existing) return existing;
    const promise = this.worker.scan(path).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, promise);
    return promise;
  }
  private replace(repository: Repository): void {
    if (this.closed) return;
    const previous = this.snapshot.repositories.find((r) => r.id === repository.id);
    if (previous) {
      const events: ActivityEvent[] = [];
      for (const branch of repository.branches) {
        const prior = previous.branches.find((b) => b.id === branch.id);
        const changed =
          prior &&
          (prior.local?.sha ?? prior.remote?.sha) !== (branch.local?.sha ?? branch.remote?.sha);
        if (!prior || changed)
          events.push({
            id: `${branch.id}:${repository.scannedAt}`,
            repositoryId: repository.id,
            branchId: branch.id,
            kind: prior ? 'commit' : 'branch',
            title: prior ? 'Branch tip changed' : 'Branch discovered',
            detail: branch.title,
            at: repository.scannedAt,
          });
      }
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
              try {
                const fresh = await this.scan(repository.path);
                if (this.snapshot.repositories.some((r) => r.id === repository.id))
                  this.replace(fresh);
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
