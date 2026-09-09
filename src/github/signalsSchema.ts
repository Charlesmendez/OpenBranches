import { z } from 'zod';
import { actorSchema, sourceActorSchema, parseActor } from './actors';
import type { PullCheck, SubmittedReview } from '../domain/pullSignals';

const sha = z
  .string()
  .regex(/^[a-f\d]{40,64}$/i)
  .transform((value) => value.toLowerCase());
const text = z.string().max(1024);
const id = z.number().int().positive().safe();
const count = z.number().int().nonnegative().max(400);
const observation = z.object({
  observedAt: z.string().max(100),
  complete: z.boolean(),
  total: count,
  error: text.optional(),
});
const check = z.object({
  id: z.string().max(100),
  name: text,
  kind: z.enum(['check', 'status']),
  state: z.enum(['failed', 'pending', 'passed', 'other']),
  result: z.string().max(100),
});
const submittedState = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
const review = z.object({
  id: z.string().max(100),
  actor: actorSchema.optional(),
  state: submittedState,
  commitSha: sha.nullable(),
  submittedAt: z.string().max(100),
});
export const pullSignalsSchema = z.object({
  headSha: sha,
  attemptedAt: z.string().max(100),
  checks: observation
    .extend({
      counts: z.object({ failed: count, pending: count, passed: count, other: count }),
      items: z.array(check).max(30),
    })
    .refine(
      (value) =>
        Object.values(value.counts).reduce((sum, count) => sum + count, 0) === value.total &&
        value.items.length <= value.total &&
        Object.entries(value.counts).every(
          ([state, count]) => value.items.filter((item) => item.state === state).length <= count,
        ),
      'Check counts are inconsistent.',
    )
    .optional(),
  reviews: observation
    .extend({ items: z.array(review).max(30) })
    .refine((value) => value.items.length <= value.total, 'Review counts are inconsistent.')
    .optional(),
});

const checkPage = z.object({
  total_count: z.number().int().nonnegative(),
  check_runs: z
    .array(
      z.object({
        id,
        name: text,
        head_sha: sha,
        status: z.string().max(100),
        conclusion: z.string().max(100).nullable(),
      }),
    )
    .max(100),
});
export function parseChecks(body: unknown, headSha: string): { items: PullCheck[]; total: number } {
  const page = checkPage.parse(body);
  return {
    total: page.total_count,
    items: page.check_runs.map((item) => {
      if (item.head_sha !== headSha) throw new Error('The check commit does not match this PR.');
      const state =
        item.status !== 'completed'
          ? ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(item.status)
            ? 'pending'
            : 'other'
          : ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(
                item.conclusion ?? '',
              )
            ? 'failed'
            : item.conclusion === 'success'
              ? 'passed'
              : 'other';
      return {
        id: String(item.id),
        name: item.name,
        kind: 'check',
        state,
        result: item.conclusion ?? item.status,
      };
    }),
  };
}
const statusPage = z.object({
  sha,
  total_count: z.number().int().nonnegative(),
  statuses: z
    .array(
      z.object({ id, context: text, state: z.enum(['error', 'failure', 'pending', 'success']) }),
    )
    .max(100),
});
export function parseStatuses(
  body: unknown,
  headSha: string,
): { items: PullCheck[]; total: number } {
  const page = statusPage.parse(body);
  if (page.sha !== headSha) throw new Error('The status commit does not match this PR.');
  return {
    total: page.total_count,
    items: page.statuses.map((item) => ({
      id: String(item.id),
      name: item.context,
      kind: 'status',
      state: item.state === 'success' ? 'passed' : item.state === 'pending' ? 'pending' : 'failed',
      result: item.state,
    })),
  };
}
const reviewPage = z
  .array(
    z.object({
      id,
      user: sourceActorSchema.nullish(),
      state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
      commit_id: sha.nullish(),
      submitted_at: z.string().max(100).nullish(),
    }),
  )
  .max(100);
export function parseReviews(body: unknown): SubmittedReview[] {
  return reviewPage.parse(body).flatMap((item) =>
    item.state === 'PENDING' || !item.submitted_at
      ? []
      : [
          {
            id: String(item.id),
            ...(item.user ? { actor: parseActor(item.user) } : {}),
            state: item.state,
            commitSha: item.commit_id ?? null,
            submittedAt: item.submitted_at,
          },
        ],
  );
}
