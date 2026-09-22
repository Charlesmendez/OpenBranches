import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { WorkspacePublisher } from '../electron/services/workspacePublisher';

afterEach(() => vi.useRealTimers());

describe('workspace publication', () => {
  it('coalesces bursts, skips identical snapshots, and delivers status-only changes separately', async () => {
    vi.useFakeTimers();
    let snapshot = createDemoSnapshot();
    let enabled = false;
    const read = vi.fn(() => ({
      'snapshot:updated': snapshot,
      'codex:updated': { enabled, installed: true, state: 'ready' as const },
      'agents:updated': [],
    }));
    const send = vi.fn();
    const publisher = new WorkspacePublisher(read, send);
    try {
      for (let i = 0; i < 20; i++) publisher.request();
      expect(read).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(read).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledTimes(3);
      send.mockClear();
      snapshot = structuredClone(snapshot);
      publisher.request();
      await vi.advanceTimersByTimeAsync(50);
      expect(send).not.toHaveBeenCalled();
      enabled = true;
      publisher.request();
      await vi.advanceTimersByTimeAsync(50);
      expect(send.mock.calls.map(([channel]) => channel)).toEqual(['codex:updated']);
      send.mockClear();
      snapshot = { ...snapshot, scanning: true };
      publisher.request();
      await vi.advanceTimersByTimeAsync(50);
      expect(send.mock.calls.map(([channel]) => channel)).toEqual(['snapshot:updated']);
    } finally {
      publisher.close();
    }
  });

  it('does not read hidden workspaces or publish after shutdown, and catches up on resume', async () => {
    vi.useFakeTimers();
    let visible = false;
    const read = vi.fn(() =>
      visible ? { 'snapshot:updated': createDemoSnapshot(), 'agents:updated': [] } : undefined,
    );
    const send = vi.fn();
    const publisher = new WorkspacePublisher(read, send);
    publisher.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(send).not.toHaveBeenCalled();
    visible = true;
    publisher.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear();
    publisher.request();
    publisher.close();
    publisher.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(send).not.toHaveBeenCalled();
  });
});
