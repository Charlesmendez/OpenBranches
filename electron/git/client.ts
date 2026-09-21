import { Worker, type WorkerOptions } from 'node:worker_threads';
import { join } from 'node:path';
import type { Repository } from '../../src/domain/types';
import type { GitInstallation } from './installation';
import { releaseUnusedMemory } from '../services/memory';

const IDLE_TIMEOUT_MS = 10_000;
const WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
} as const;

interface GitWorkerClientOptions {
  idleTimeoutMs?: number;
  createWorker?: (filename: string, options: WorkerOptions) => Worker;
  releaseMemory?: (immediate?: boolean) => void;
}

interface Request {
  resolve(repository: Repository): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The scanner never blocks Electron's UI process. A failed worker is recreated
 * on the next request, and every outstanding caller gets a terminal result. */
export class GitWorkerClient {
  private worker?: Worker;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private releaseWhenIdle = false;
  private nextId = 0;
  private pending = new Map<number, Request>();
  private closed = false;
  private idleTimeoutMs: number;
  private createWorker: NonNullable<GitWorkerClientOptions['createWorker']>;
  private releaseMemory: NonNullable<GitWorkerClientOptions['releaseMemory']>;
  constructor(
    private git: Pick<GitInstallation, 'executable'>,
    options: GitWorkerClientOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.createWorker =
      options.createWorker ?? ((filename, workerOptions) => new Worker(filename, workerOptions));
    this.releaseMemory = options.releaseMemory ?? releaseUnusedMemory;
  }

  async scan(path: string): Promise<Repository> {
    const executable = await this.git.executable();
    if (this.closed) return Promise.reject(new Error('Repository scanner is closed'));
    this.clearIdleTimer();
    const worker = this.worker ?? this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            worker,
            new Error('Repository inspection timed out. Try again or inspect fewer worktrees.'),
          ),
        150_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, path, executable });
      } catch (error) {
        this.fail(worker, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private start(): Worker {
    const worker = this.createWorker(join(__dirname, 'git-worker.js'), {
      resourceLimits: WORKER_RESOURCE_LIMITS,
    });
    this.worker = worker;
    worker.on('message', ({ id, repository, error }) => {
      if (this.worker !== worker) return;
      const request = this.pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(id);
      error ? request.reject(new Error(error)) : request.resolve(repository);
      this.releaseMemory();
      if (this.releaseWhenIdle) this.retire(worker);
      else this.scheduleIdle(worker);
    });
    worker.on('error', (error) =>
      this.fail(worker, error instanceof Error ? error : new Error(String(error))),
    );
    worker.on('exit', (code) =>
      this.fail(worker, new Error(`Repository scanner stopped (${code}). Refresh to retry.`)),
    );
    return worker;
  }

  private scheduleIdle(worker: Worker): void {
    if (this.closed || this.worker !== worker || this.pending.size) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.retire(worker);
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  /** Release the scanner's V8 isolate after a full reconciliation. If a
   * watcher scan is still active, retire it as soon as all results arrive. */
  release(): void {
    if (this.closed || !this.worker) return;
    this.releaseWhenIdle = true;
    this.retire(this.worker);
  }

  private retire(worker: Worker): void {
    if (this.worker !== worker || this.pending.size) return;
    this.clearIdleTimer();
    this.releaseWhenIdle = false;
    this.worker = undefined;
    void worker.terminate();
    this.releaseMemory(true);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private fail(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.clearIdleTimer();
    this.releaseWhenIdle = false;
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    void worker.terminate();
    this.releaseMemory(true);
  }

  close() {
    this.closed = true;
    this.clearIdleTimer();
    if (this.worker) this.fail(this.worker, new Error('Repository scanner closed'));
  }
}
