import { isDeepStrictEqual } from 'node:util';
import type {
  AgentHistoryStatus,
  AgentLiveStatus,
  CodexStatus,
  Snapshot,
} from '../../src/domain/types';

interface WorkspaceUpdates {
  'snapshot:updated': Snapshot;
  'codex:updated'?: CodexStatus;
  'agents:updated': AgentHistoryStatus[];
  'agents:live-updated'?: AgentLiveStatus[];
}

/** Coalesce source completions and deliver only changed channels. Payloads are
 * immutable observations: repository updates must replace, not mutate, them. */
export class WorkspacePublisher {
  private previous = new Map<string, unknown>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private read: () => WorkspaceUpdates | undefined,
    private send: (channel: keyof WorkspaceUpdates, value: unknown) => void,
  ) {}

  request(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const updates = this.read();
      if (!updates) return;
      for (const channel of Object.keys(updates) as Array<keyof WorkspaceUpdates>) {
        const value = updates[channel];
        if (value === undefined || isDeepStrictEqual(this.previous.get(channel), value)) continue;
        this.send(channel, value);
        this.previous.set(channel, value);
      }
    }, 50);
    this.timer.unref?.();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.previous.clear();
  }
}
