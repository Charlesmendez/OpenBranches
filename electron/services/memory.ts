import { Session } from 'node:inspector';

const MINIMUM_INTERVAL_MS = 30_000;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let collecting = false;
let lastCollection = Number.NEGATIVE_INFINITY;

/** Ask V8 to reclaim unreachable scan and snapshot copies after bursty Git work.
 * Requests are coalesced, while an end-of-batch request can run immediately. */
export function releaseUnusedMemory(immediate = false): void {
  if (collecting) return;
  if (immediate && scheduled) {
    clearTimeout(scheduled);
    scheduled = undefined;
  }
  if (scheduled) return;
  const delay = immediate ? 0 : Math.max(0, lastCollection + MINIMUM_INTERVAL_MS - Date.now());
  scheduled = setTimeout(() => {
    scheduled = undefined;
    collecting = true;
    const session = new Session();
    try {
      session.connect();
      session.post('HeapProfiler.collectGarbage', () => {
        try {
          session.disconnect();
        } finally {
          lastCollection = Date.now();
          collecting = false;
        }
      });
    } catch {
      lastCollection = Date.now();
      collecting = false;
      try {
        session.disconnect();
      } catch {
        // The session never connected.
      }
    }
  }, delay);
  scheduled.unref?.();
}
