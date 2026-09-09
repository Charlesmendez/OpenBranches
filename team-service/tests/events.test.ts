import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamEvents } from '../src/events';
import type { TeamDatabase } from '../src/db';

function client() {
  return Object.assign(new EventEmitter(), {
    query: vi.fn().mockResolvedValue({}),
    release: vi.fn(),
  });
}
afterEach(() => vi.useRealTimers());
describe('notification recovery', () => {
  it('retries repeated connection failures and invalidates missed changes on recovery', async () => {
    vi.useFakeTimers();
    const first = client(),
      second = client();
    const connect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce(second);
    const events = new TeamEvents({ pool: { connect } } as unknown as TeamDatabase);
    const update = vi.fn();
    events.subscribe(randomUUID(), update);
    await events.start();
    expect(update).toHaveBeenCalledTimes(1);
    first.emit('error', new Error('connection lost'));
    expect(first.release).toHaveBeenCalledExactlyOnceWith(true);
    await vi.advanceTimersByTimeAsync(9000);
    expect(connect).toHaveBeenCalledTimes(4);
    expect(second.query).toHaveBeenCalledWith('LISTEN openbranches_team_changed');
    expect(update).toHaveBeenCalledTimes(3);
    await events.close();
    expect(second.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).toHaveBeenCalledTimes(4);
  });
  it('serializes concurrent starts and closes a connection acquired during shutdown', async () => {
    let resolve!: (value: ReturnType<typeof client>) => void;
    const pending = {
      promise: new Promise<ReturnType<typeof client>>((done) => {
        resolve = done;
      }),
      resolve: (value: ReturnType<typeof client>) => resolve(value),
    };
    const connect = vi.fn(() => pending.promise);
    const events = new TeamEvents({ pool: { connect } } as unknown as TeamDatabase);
    const first = events.start(),
      second = events.start(),
      closing = events.close(),
      acquired = client();
    pending.resolve(acquired);
    await Promise.all([first, second, closing]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(acquired.query).not.toHaveBeenCalled();
    expect(acquired.release).toHaveBeenCalledTimes(1);
  });
  it('handles orderly disconnects and isolates workspace notifications and subscribers', async () => {
    vi.useFakeTimers();
    const current = client(),
      replacement = client(),
      workspaceId = randomUUID();
    const connect = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(replacement);
    const events = new TeamEvents({ pool: { connect } } as unknown as TeamDatabase);
    await events.start();
    const own = vi.fn(),
      other = vi.fn();
    events.subscribe(workspaceId, () => {
      throw new Error('subscriber closed');
    });
    events.subscribe(workspaceId, own);
    events.subscribe(randomUUID(), other);
    const send = (value: unknown) =>
      current.emit('notification', {
        channel: 'openbranches_team_changed',
        payload: JSON.stringify(value),
      });
    send({ workspaceId, revision: '4', snapshot: 'untrusted extra field' });
    expect(own).not.toHaveBeenCalled();
    send({ workspaceId, revision: '5' });
    expect(own).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    current.emit('end');
    await vi.advanceTimersByTimeAsync(3000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(current.listenerCount('notification')).toBe(0);
    await events.close();
  });
});
