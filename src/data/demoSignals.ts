import type { GitHubActor } from '../domain/types';
import type { PullSignals } from '../domain/pullSignals';

/** Fictional states only, kept separate from all live connection caches. */
export function demoSignals(
  headSha: string,
  index: number,
  actor: GitHubActor,
  now: number,
): PullSignals | undefined {
  if (index % 7 === 6) return undefined;
  const observedAt = new Date(now - (index % 7 === 5 ? 20 * 60_000 : 60_000)).toISOString();
  const state =
    index % 5 === 0 ? 'failed' : index % 5 === 1 ? 'pending' : index % 5 === 2 ? 'other' : 'passed';
  return {
    headSha,
    attemptedAt: observedAt,
    checks: {
      observedAt,
      complete: index % 7 !== 4,
      total: 3,
      counts: {
        failed: state === 'failed' ? 1 : 0,
        pending: state === 'pending' ? 1 : 0,
        other: state === 'other' ? 1 : 0,
        passed: state === 'passed' ? 3 : 2,
      },
      items: [
        {
          id: '901',
          name: 'Build & tests',
          kind: 'check',
          state,
          result:
            state === 'failed'
              ? 'failure'
              : state === 'pending'
                ? 'in_progress'
                : state === 'other'
                  ? 'skipped'
                  : 'success',
        },
        { id: '902', name: 'Type checking', kind: 'check', state: 'passed', result: 'success' },
        {
          id: '903',
          name: 'Preview deployment',
          kind: 'status',
          state: 'passed',
          result: 'success',
        },
      ],
    },
    reviews: {
      observedAt,
      complete: true,
      total: 2,
      items: [
        {
          id: '905',
          actor,
          state: index % 3 === 0 ? 'CHANGES_REQUESTED' : 'COMMENTED',
          commitSha: headSha,
          submittedAt: new Date(now - 2 * 3_600_000).toISOString(),
        },
        {
          id: '904',
          actor,
          state: index % 4 === 0 ? 'DISMISSED' : 'APPROVED',
          commitSha: 'f'.repeat(40),
          submittedAt: new Date(now - 2 * 86_400_000).toISOString(),
        },
      ],
    },
  };
}
