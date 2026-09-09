import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppStore } from '../services/store';
import { ADVISOR_POLICY as policy } from './policy';

const attemptSchema = z.object({
  id: z.string(),
  startedAt: z.number().int().nonnegative(),
  revision: z.string(),
  outcome: z.enum(['running', 'completed', 'failed']),
});
const ledgerSchema = z.object({
  version: z.literal(1),
  attempts: z.array(attemptSchema).max(1000),
});
type Ledger = z.infer<typeof ledgerSchema>;
export interface AdvisorBudgetStatus {
  reason: 'ready' | 'running' | 'spacing' | 'daily-limit' | 'clock-changed' | 'unavailable';
  remaining: number;
  nextRunAt?: number;
}

// Owned by the single Electron main process. Reserve synchronously before any
// asynchronous work so parallel requests cannot both claim the same allowance.
export class AdvisorBudget {
  constructor(private store: Pick<AppStore, 'readStrict' | 'write'>) {}
  private read(): Ledger {
    const value = this.store.readStrict('advisor.ledger');
    return value === undefined ? { version: 1, attempts: [] } : ledgerSchema.parse(value);
  }
  status(now = Date.now()): AdvisorBudgetStatus {
    if (!Number.isSafeInteger(now) || now < 0) return { reason: 'unavailable', remaining: 0 };
    try {
      const attempts = this.read().attempts.filter((a) => a.startedAt > now - policy.windowMs);
      const latest = Math.max(0, ...attempts.map((a) => a.startedAt));
      const remaining = Math.max(0, policy.maxRuns - attempts.length);
      if (latest > now)
        return { reason: 'clock-changed', remaining, nextRunAt: latest + policy.spacingMs };
      if (attempts.some((a) => a.outcome === 'running' && a.startedAt + policy.timeoutMs > now))
        return { reason: 'running', remaining, nextRunAt: latest + policy.spacingMs };
      if (!remaining)
        return {
          reason: 'daily-limit',
          remaining,
          nextRunAt: Math.max(
            Math.min(...attempts.map((a) => a.startedAt)) + policy.windowMs,
            latest + policy.spacingMs,
          ),
        };
      if (attempts.length && latest + policy.spacingMs > now)
        return { reason: 'spacing', remaining, nextRunAt: latest + policy.spacingMs };
      return { reason: 'ready', remaining };
    } catch {
      return { reason: 'unavailable', remaining: 0 };
    }
  }
  reserve(revision: string, now = Date.now()): string {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid advisor evidence revision.');
    const status = this.status(now);
    if (status.reason !== 'ready')
      throw new Error(`Advisor allowance unavailable: ${status.reason}.`);
    const ledger = this.read();
    ledger.attempts = ledger.attempts.filter((a) => a.startedAt > now - policy.windowMs);
    const id = randomUUID();
    ledger.attempts.push({ id, startedAt: now, revision, outcome: 'running' });
    // Failures and uncertain outcomes retain their charge. Never refund a run
    // whose request might have reached Codex, including after an app restart.
    this.store.write('advisor.ledger', ledger);
    return id;
  }
  finish(id: string, outcome: 'completed' | 'failed') {
    const ledger = this.read();
    const attempt = ledger.attempts.find((entry) => entry.id === id);
    if (!attempt || attempt.outcome !== 'running') return;
    attempt.outcome = outcome;
    this.store.write('advisor.ledger', ledger);
  }
}
