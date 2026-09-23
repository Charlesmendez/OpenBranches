import { watch, type FSWatcher } from 'node:fs';
import type { Repository, Snapshot } from '../../src/domain/types';
import { observedActivity } from '../../src/domain/activity';
import { AppStore } from './store';
import { GitWorkerClient } from '../git/client';
import type { GitInstallation } from '../git/installation';

const RECONCILE_INTERVAL = 5 * 60_000;
const WATCH_SCAN_INTERVAL = 30_000;
type RepositoryWorker = Pick<GitWorkerClient, 'scan' | 'close'> &
  Partial<Pick<GitWorkerClient, 'release'>>;

export class RepositoryService {
  private snapshot: Snapshot;
  private worker: RepositoryWorker;
  private closed = false;
  private refreshing?: Promise<void>;
  private watchPaths = new Map<string, string>();
  private watchers = new Map<string, FSWatcher[]>();
  private debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private dirty = new Set<string>();
  private urgent = new Set<string>();
  private watchJobs = new Map<string, number>();
  private lastScan = new Map<string, number>();
  private inFlight = new Map<string, Promise<Repository>>();
  private revisions = new Map<string, number>();
  private reconcile?: ReturnType<typeof setInterval>;
  private suspended = false;
  constructor(
    private store: AppStore,
    private publish: (snapshot: Snapshot) => void,
    git: Pick<GitInstallation, 'executable'>,
    worker: RepositoryWorker = new GitWorkerClient(git),
    private watchDirectory: typeof watch = watch,
  ) {
    this.worker = worker;
    this.snapshot = { ...store.snapshot(), scanning: false };
    this.startReconciliation();
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
    this.lastScan.set(repository.path, Date.now());
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
    for (const path of [removed.path, ...removed.worktrees.map((tree) => tree.path)]) {
      this.inFlight.delete(path);
      this.lastScan.delete(path);
    }
    this.watchers.get(id)?.forEach((w) => w.close());
    this.watchers.delete(id);
    this.watchPaths.delete(id);
    const timer = this.debounces.get(id);
    if (timer) clearTimeout(timer);
    this.debounces.delete(id);
    this.dirty.delete(id);
    this.urgent.delete(id);
    this.snapshot = next;
    adoptConnections?.();
    this.publish(this.snapshot);
  }
  refresh(): Promise<void> {
    if (this.closed || this.suspended) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshAll().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  /** Stop background filesystem and Git work while the desktop window is inactive. */
  setSuspended(suspended: boolean): void {
    if (this.closed || suspended === this.suspended) return;
    this.suspended = suspended;
    if (suspended) {
      if (this.reconcile) clearInterval(this.reconcile);
      this.reconcile = undefined;
      this.watchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()));
      this.watchers.clear();
      this.watchPaths.clear();
      this.debounces.forEach(clearTimeout);
      this.debounces.clear();
      this.dirty.clear();
      this.urgent.clear();
      return;
    }
    this.startReconciliation();
    for (const repository of this.snapshot.repositories) this.watchRepository(repository);
  }
  private async refreshAll(): Promise<void> {
    this.snapshot = { ...this.snapshot, scanning: true };
    this.publish(this.snapshot);
    for (const repository of [...this.snapshot.repositories]) {
      if (this.closed || this.suspended) break;
      const revision = this.revision(repository.id);
      if (!this.isCurrent(repository.id, revision)) continue;
      try {
        const fresh = await this.scan(repository.path);
        if (this.isCurrent(repository.id, revision)) this.replace(fresh, false);
      } catch (error) {
        const current = this.snapshot.repositories.find((r) => r.id === repository.id);
        if (current && this.isCurrent(repository.id, revision))
          this.replace(
            {
              ...current,
              error: error instanceof Error ? error.message : 'Repository unavailable',
            },
            false,
          );
      }
    }
    this.snapshot = { ...this.snapshot, scanning: false };
    try {
      this.emit();
    } finally {
      this.worker.release?.();
    }
  }
  private scan(path: string): Promise<Repository> {
    const existing = this.inFlight.get(path);
    if (existing) return existing;
    // A manual or reconciliation scan also consumes changes queued before it.
    // Events arriving during that scan remain dirty for a trailing pass.
    for (const repository of this.snapshot.repositories) {
      if (repository.path !== path) continue;
      this.lastScan.set(path, Date.now());
      this.dirty.delete(repository.id);
      this.urgent.delete(repository.id);
      const timer = this.debounces.get(repository.id);
      if (timer) clearTimeout(timer);
      this.debounces.delete(repository.id);
    }
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
  private scheduleWatchScan(id: string): void {
    const revision = this.revision(id);
    if (
      this.closed ||
      this.suspended ||
      !this.dirty.has(id) ||
      this.debounces.has(id) ||
      this.watchJobs.get(id) === revision
    )
      return;
    const repository = this.snapshot.repositories.find((item) => item.id === id);
    if (!repository) return;
    const elapsed = Date.now() - (this.lastScan.get(repository.path) ?? Number.NEGATIVE_INFINITY);
    const delay = Math.max(
      500,
      this.urgent.has(id) || elapsed < 0 ? 0 : WATCH_SCAN_INTERVAL - elapsed,
    );
    const timer = setTimeout(async () => {
      this.debounces.delete(id);
      if (this.suspended || !this.isCurrent(id, revision) || !this.dirty.has(id)) return;
      if (this.snapshot.repositories.find((item) => item.id === id)?.path !== repository.path) {
        this.scheduleWatchScan(id);
        return;
      }
      this.watchJobs.set(id, revision);
      try {
        const existing = this.inFlight.get(repository.path);
        if (existing) {
          // Do not republish the same scan or lose edits made while it was running.
          await existing;
        } else {
          const fresh = await this.scan(repository.path);
          if (!this.suspended && this.isCurrent(id, revision)) this.replace(fresh);
        }
      } catch {
        // A later event or the reconciliation pass retries unavailable repositories.
      } finally {
        if (this.watchJobs.get(id) === revision) this.watchJobs.delete(id);
        if (this.isCurrent(id, revision)) this.scheduleWatchScan(id);
      }
    }, delay);
    timer.unref?.();
    this.debounces.set(id, timer);
  }
  private replace(repository: Repository, emit = true): void {
    if (this.closed) return;
    const previous = this.snapshot.repositories.find((r) => r.id === repository.id);
    if (previous && previous.path !== repository.path) this.lastScan.delete(previous.path);
    const events = previous ? observedActivity(previous, repository) : [];
    this.snapshot = {
      ...this.snapshot,
      events: [...events, ...this.snapshot.events].slice(0, 500),
      repositories: [
        ...this.snapshot.repositories.filter((r) => r.id !== repository.id),
        repository,
      ].sort((a, b) => a.name.localeCompare(b.name)),
    };
    this.watchRepository(repository);
    if (emit) this.emit();
  }
  private watchRepository(repository: Repository): void {
    if (this.closed || this.suspended) return;
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
    const revision = this.revision(repository.id);
    const ignored =
      /(^|\/)(node_modules|dist|out|build|target|\.next|\.cache|coverage|\.venv)(\/|$)/;
    for (const path of paths) {
      try {
        const watcher = this.watchDirectory(path, { recursive: true }, (_event, filename) => {
          if (this.suspended || !this.isCurrent(repository.id, revision)) return;
          if (filename && ignored.test(String(filename))) return;
          this.dirty.add(repository.id);
          // Checkout/ref changes affect which branch a live task belongs to.
          // Keep those prompt; only ordinary working-file bursts wait for the cap.
          const name = filename?.toString().replaceAll('\\', '/');
          const gitPath =
            path === repository.commonDir
              ? name
              : name === '.git'
                ? 'HEAD'
                : name?.startsWith('.git/')
                  ? name.slice(5)
                  : undefined;
          if (
            gitPath !== undefined &&
            /(^|\/)(HEAD|packed-refs|config|gitdir|commondir)$|(^|\/)refs\/(?!.*\.lock$).+|^worktrees(?:\/[^/]+)?$/.test(
              gitPath,
            ) &&
            !this.urgent.has(repository.id)
          ) {
            this.urgent.add(repository.id);
            const timer = this.debounces.get(repository.id);
            if (timer) clearTimeout(timer);
            this.debounces.delete(repository.id);
          }
          this.scheduleWatchScan(repository.id);
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
  private startReconciliation(): void {
    if (this.closed || this.suspended || this.reconcile) return;
    this.reconcile = setInterval(() => {
      void this.refresh();
    }, RECONCILE_INTERVAL);
    this.reconcile.unref?.();
  }
  private emit(): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, updatedAt: new Date().toISOString() };
    this.store.write('snapshot', this.snapshot);
    this.publish(this.snapshot);
  }
  close(): void {
    this.closed = true;
    if (this.reconcile) clearInterval(this.reconcile);
    this.watchers.forEach((ws) => ws.forEach((w) => w.close()));
    this.debounces.forEach(clearTimeout);
    this.debounces.clear();
    this.dirty.clear();
    this.urgent.clear();
    this.lastScan.clear();
    this.watchJobs.clear();
    this.worker.close();
  }
}
