import { EventEmitter } from 'node:events';
import type { Worker, WorkerOptions } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitWorkerClient } from '../electron/git/client';
import { createDemoSnapshot } from '../src/data/demo';

class FakeWorker extends EventEmitter {
  messages: Array<{ id: number; path: string; executable: string }> = [];
  terminated = false;

  postMessage(message: { id: number; path: string; executable: string }) {
    this.messages.push(message);
  }

  async terminate() {
    this.terminated = true;
    return 0;
  }
}

function fixture() {
  const workers: FakeWorker[] = [];
  const options: WorkerOptions[] = [];
  const releaseMemory = vi.fn();
  const client = new GitWorkerClient(
    { executable: async () => '/fixture/git' },
    {
      idleTimeoutMs: 10_000,
      createWorker: (_filename, workerOptions) => {
        const worker = new FakeWorker();
        workers.push(worker);
        options.push(workerOptions);
        return worker as unknown as Worker;
      },
      releaseMemory,
    },
  );
  return { client, workers, options, releaseMemory };
}

async function started() {
  // The client awaits executable discovery before creating its worker.
  await Promise.resolve();
}

describe('Git worker client memory lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('releases an idle scanner and caps its V8 heap', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const repository = createDemoSnapshot().repositories[0];
    const result = f.client.scan('/fixture/repository');
    await started();
    const worker = f.workers[0];
    const request = worker.messages[0];

    worker.emit('message', { id: request.id, repository });
    await expect(result).resolves.toEqual(repository);
    expect(f.options[0].resourceLimits).toEqual({
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 32,
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminated).toBe(true);
    expect(f.releaseMemory).toHaveBeenNthCalledWith(1);
    expect(f.releaseMemory).toHaveBeenLastCalledWith(true);
  });

  it('cancels retirement for sequential scans and starts fresh after retiring', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const repository = createDemoSnapshot().repositories[0];
    const first = f.client.scan('/fixture/one');
    await started();
    const worker = f.workers[0];
    worker.emit('message', { id: worker.messages[0].id, repository });
    await first;

    await vi.advanceTimersByTimeAsync(9_999);
    const second = f.client.scan('/fixture/two');
    await started();
    expect(f.workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminated).toBe(false);

    worker.emit('message', { id: worker.messages[1].id, repository });
    await second;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(worker.terminated).toBe(true);

    const third = f.client.scan('/fixture/three');
    await started();
    expect(f.workers).toHaveLength(2);
    f.workers[1].emit('message', { id: f.workers[1].messages[0].id, repository });
    await third;
    f.client.close();
  });

  it('honors an explicit release as soon as pending scans finish', async () => {
    const f = fixture();
    const repository = createDemoSnapshot().repositories[0];
    const first = f.client.scan('/fixture/one');
    const second = f.client.scan('/fixture/two');
    await started();
    const worker = f.workers[0];

    f.client.release();
    expect(worker.terminated).toBe(false);
    worker.emit('message', { id: worker.messages[0].id, repository });
    await first;
    expect(worker.terminated).toBe(false);
    worker.emit('message', { id: worker.messages[1].id, repository });
    await second;
    expect(worker.terminated).toBe(true);
    expect(f.releaseMemory).toHaveBeenLastCalledWith(true);
  });

  it('rejects every pending scan and recreates a failed worker', async () => {
    const f = fixture();
    const first = f.client.scan('/fixture/one');
    const second = f.client.scan('/fixture/two');
    const settled = Promise.allSettled([first, second]);
    await started();
    const worker = f.workers[0];

    worker.emit('error', new Error('worker failure'));
    expect(await settled).toEqual([
      { status: 'rejected', reason: new Error('worker failure') },
      { status: 'rejected', reason: new Error('worker failure') },
    ]);
    expect(worker.terminated).toBe(true);
    expect(f.releaseMemory).toHaveBeenLastCalledWith(true);

    const retry = f.client.scan('/fixture/retry');
    await started();
    expect(f.workers).toHaveLength(2);
    f.workers[1].emit('message', {
      id: f.workers[1].messages[0].id,
      repository: createDemoSnapshot().repositories[0],
    });
    await retry;
    f.client.close();
  });

  it('cancels idle retirement on close without leaving a worker alive', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = f.client.scan('/fixture/repository');
    await started();
    const worker = f.workers[0];
    worker.emit('message', {
      id: worker.messages[0].id,
      repository: createDemoSnapshot().repositories[0],
    });
    await result;

    f.client.close();
    expect(worker.terminated).toBe(true);
    await vi.runAllTimersAsync();
    expect(f.workers).toHaveLength(1);
  });
});
