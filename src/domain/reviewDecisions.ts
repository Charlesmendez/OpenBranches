import { z } from 'zod';
import type { Recommendation, ReviewCommand, ReviewState } from './types';
import { SNOOZE_MS } from './reviews';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewCommandSchema = z
  .object({
    id: z.string().min(1).max(4096),
    revision,
    choice: z.enum(['dismissed', 'snoozed', 'restore']),
  })
  .strict();
const decisionSchema = z
  .object({
    id: z.string().min(1).max(4096),
    repositoryId: z.string().min(1).max(4096),
    revision,
    choice: z.enum(['dismissed', 'snoozed']),
    decidedAt: z.number().int().nonnegative().safe(),
    until: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .refine((value) =>
    value.choice === 'snoozed'
      ? value.until === value.decidedAt + SNOOZE_MS
      : value.until === undefined,
  );
export const reviewLedgerSchema = z
  .object({ version: z.literal(1), decisions: z.array(decisionSchema).max(50_000) })
  .strict()
  .refine(
    (value) =>
      new Set(value.decisions.map((decision) => decision.id)).size === value.decisions.length,
  );

export function readReviewState(value: unknown): ReviewState {
  if (value === undefined || value === null) return { decisions: [] };
  const parsed = reviewLedgerSchema.safeParse(value);
  return parsed.success
    ? { decisions: parsed.data.decisions }
    : {
        decisions: [],
        error:
          'Saved review choices could not be read. Findings remain visible. Reset review choices to start a new history.',
      };
}
export function applyReviewCommand(
  state: ReviewState,
  command: ReviewCommand,
  recommendations: Recommendation[],
  now = Date.now(),
): ReviewState {
  if (state.error)
    throw new Error('Reset the unreadable review history before saving a new choice.');
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error('The current time could not be checked.');
  const current = recommendations.find((item) => item.id === command.id);
  if (!current || current.revision !== command.revision)
    throw new Error('This finding changed. Review its current evidence before choosing again.');
  const decisions = state.decisions.filter((item) => item.id !== command.id);
  if (command.choice !== 'restore') {
    decisions.push({
      id: current.id,
      repositoryId: current.repositoryId,
      revision: current.revision,
      choice: command.choice,
      decidedAt: now,
      ...(command.choice === 'snoozed' ? { until: now + SNOOZE_MS } : {}),
    });
  }
  reviewLedgerSchema.parse({ version: 1, decisions });
  return { decisions };
}
