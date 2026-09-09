import type { GitHubActor } from './types';
import { sourceStale as observationStale } from './sourceFreshness';
export { sourceStale as observationStale } from './sourceFreshness';

export type CheckState = 'failed' | 'pending' | 'passed' | 'other';
export interface PullCheck {
  id: string;
  name: string;
  kind: 'check' | 'status';
  state: CheckState;
  result: string;
}
export interface SubmittedReview {
  id: string;
  actor?: GitHubActor;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  commitSha: string | null;
  submittedAt: string;
}
export interface Observation {
  observedAt: string;
  complete: boolean;
  total: number;
  error?: string;
}
export interface PullSignals {
  headSha: string;
  attemptedAt: string;
  checks?: Observation & {
    counts: Record<CheckState, number>;
    items: PullCheck[];
  };
  reviews?: Observation & { items: SubmittedReview[] };
}

export function checksSummary(
  headSha: string,
  signals?: PullSignals,
  now = Date.now(),
): { state: CheckState | 'unknown'; label: string } {
  const checks = signals?.checks;
  if (!checks) return { state: 'unknown', label: 'Checks not read yet' };
  if (signals?.headSha !== headSha)
    return { state: 'unknown', label: 'Checks from a different commit' };
  if (observationStale(checks, now)) return { state: 'unknown', label: 'Saved check results' };
  if (checks.counts.failed)
    return {
      state: 'failed',
      label: `${checks.counts.failed} ${checks.counts.failed === 1 ? 'check needs' : 'checks need'} attention`,
    };
  if (!checks.complete) return { state: 'unknown', label: 'Checks partly read' };
  if (!checks.total) return { state: 'unknown', label: 'No checks reported' };
  if (checks.counts.pending)
    return {
      state: 'pending',
      label: `${checks.counts.pending} ${checks.counts.pending === 1 ? 'check' : 'checks'} pending`,
    };
  if (checks.counts.other) return { state: 'other', label: 'Check results to review' };
  return {
    state: 'passed',
    label: `${checks.counts.passed} ${checks.counts.passed === 1 ? 'check' : 'checks'} passed`,
  };
}

/** This is evidence of reported failures, never a merge-readiness decision. */
export function hasFailedChecks(
  pull: {
    headSha: string;
    state: string;
    signals?: PullSignals;
    retained?: boolean;
    sourceError?: string;
  },
  now = Date.now(),
) {
  return (
    pull.state === 'open' &&
    !pull.retained &&
    !pull.sourceError &&
    checksSummary(pull.headSha, pull.signals, now).state === 'failed'
  );
}
