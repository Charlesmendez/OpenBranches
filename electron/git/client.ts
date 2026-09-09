import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { Repository } from '../../src/domain/types';
import type { GitInstallation } from './installation';

interface Request {
  resolve(repository: Repository): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The scanner never blocks Electron's UI process. A failed worker is recreated
 * on the next request, and every outstanding caller gets a terminal result. */
export class GitWorkerClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, Request>();
  private closed = false;
  constructor(private git: Pick<GitInstallation, 'executable'>) {}

  async scan(path: string): Promise<Repository> {
    const executable = await this.git.executable();
    if (this.closed) return Promise.reject(new Error('Repository scanner is closed'));
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
      worker.postMessage({ id, path, executable });
    });
  }

  private start(): Worker {
    const worker = new Worker(join(__dirname, 'git-worker.js'));
    this.worker = worker;
    worker.on('message', ({ id, repository, error }) => {
      if (this.worker !== worker) return;
      const request = this.pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(id);
      error ? request.reject(new Error(error)) : request.resolve(repository);
    });
    worker.on('error', (error) =>
      this.fail(worker, error instanceof Error ? error : new Error(String(error))),
    );
    worker.on('exit', (code) =>
      this.fail(worker, new Error(`Repository scanner stopped (${code}). Refresh to retry.`)),
    );
    return worker;
  }

  private fail(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    void worker.terminate();
  }

  close() {
    this.closed = true;
    if (this.worker) this.fail(this.worker, new Error('Repository scanner closed'));
  }
}
