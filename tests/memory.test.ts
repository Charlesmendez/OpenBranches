import { afterEach, describe, expect, it, vi } from 'vitest';

const inspector = vi.hoisted(() => ({
  connections: 0,
  disconnections: 0,
  collections: 0,
}));

vi.mock('node:inspector', () => ({
  Session: class {
    connect() {
      inspector.connections++;
    }
    post(method: string, callback: () => void) {
      expect(method).toBe('HeapProfiler.collectGarbage');
      inspector.collections++;
      callback();
    }
    disconnect() {
      inspector.disconnections++;
    }
  },
}));

import { releaseUnusedMemory } from '../electron/services/memory';

describe('main-process memory reclamation', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces routine requests and lets an end-of-batch request run immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    releaseUnusedMemory();
    releaseUnusedMemory();
    await vi.advanceTimersByTimeAsync(0);
    expect(inspector).toEqual({ connections: 1, disconnections: 1, collections: 1 });

    releaseUnusedMemory();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(inspector.collections).toBe(1);

    releaseUnusedMemory(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(inspector).toEqual({ connections: 2, disconnections: 2, collections: 2 });
  });
});
