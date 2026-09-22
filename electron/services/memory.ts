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
    let disconnectScheduled = false;
    const finish = () => {
      if (disconnectScheduled) return;
      disconnectScheduled = true;
      // Electron can deadlock if an inspector response disconnects its own
      // session. Let the response return before disposing the connection.
      setImmediate(() => {
        try {
          session.disconnect();
        } catch {
          // The session may never have connected.
        } finally {
          lastCollection = Date.now();
          collecting = false;
        }
      });
    };
    try {
      session.connect();
      session.post('HeapProfiler.collectGarbage', finish);
    } catch {
      finish();
    }
  }, delay);
  scheduled.unref?.();
}
