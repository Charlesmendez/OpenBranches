import { afterEach, describe, expect, it, vi } from 'vitest';

const inspector = vi.hoisted(() => ({
  connections: 0,
  disconnections: 0,
  collections: 0,
  callbackActive: false,
  disconnectedInCallback: false,
}));

vi.mock('node:inspector', () => ({
  Session: class {
    connect() {
      inspector.connections++;
    }
    post(method: string, callback: () => void) {
      expect(method).toBe('HeapProfiler.collectGarbage');
      inspector.collections++;
      inspector.callbackActive = true;
      callback();
      inspector.callbackActive = false;
    }
    disconnect() {
      inspector.disconnections++;
      inspector.disconnectedInCallback ||= inspector.callbackActive;
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
    expect(inspector.collections).toBe(1);
    expect(inspector.disconnections).toBe(0);
    releaseUnusedMemory(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(inspector.connections).toBe(1);
    expect(inspector.disconnections).toBe(1);
    expect(inspector.disconnectedInCallback).toBe(false);

    releaseUnusedMemory();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(inspector.collections).toBe(1);

    releaseUnusedMemory(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(inspector.connections).toBe(2);
    expect(inspector.disconnections).toBe(2);
    expect(inspector.collections).toBe(2);
    expect(inspector.disconnectedInCallback).toBe(false);
  });
});
