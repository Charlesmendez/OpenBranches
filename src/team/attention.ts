import { z } from 'zod';
import { teamId } from './protocol';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const attentionKind = z.enum([
  'checks-failing',
  'review-requested',
  'stale-draft',
  'merged-branch',
  'local-only',
  'forgotten-work',
]);
export const attentionBucket = z.enum(['active', 'snoozed', 'dismissed']);
export const attentionSignals = z.strictObject({
  failingChecks: z.boolean(),
  reviewRequested: z.boolean(),
  staleDraft: z.boolean(),
  mergedBranch: z.boolean(),
  // Defaults keep v1 GitHub projections written before local evidence was
  // added readable during a rolling service upgrade.
  localOnly: z.boolean().default(false),
  forgottenWork: z.boolean().default(false),
});
export const attentionEvidenceItem = z.strictObject({
  id: digest,
  revision: digest,
  kind: attentionKind,
  priority: z.enum(['urgent', 'review', 'cleanup']),
  title: z.string().min(1).max(8192),
  pullTitle: z.string().min(1).max(8192),
  pullNumber: z.number().int().positive().safe(),
  url: z.string().url().max(8192),
  branch: z.string().max(8192),
  base: z.string().max(8192),
  author: z.string().min(1).max(200).nullable(),
  requestedReviewerIds: z.array(z.string().regex(/^[1-9]\d{0,15}$/)).max(100),
  evidence: z.array(z.string().min(1).max(400)).min(1).max(4),
  observedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  signals: attentionSignals,
});
export const storedAttentionProjection = z.strictObject({
  version: z.literal(1),
  observedAt: z.iso.datetime(),
  counts: z.strictObject({
    findings: z.number().int().nonnegative().max(5_300),
    failingChecks: z.number().int().nonnegative().max(5_300),
    reviewRequested: z.number().int().nonnegative().max(5_300),
    staleDrafts: z.number().int().nonnegative().max(5_300),
    mergedBranches: z.number().int().nonnegative().max(5_300),
  }),
  items: z.array(attentionEvidenceItem).max(100),
  omitted: z.number().int().nonnegative().max(5_300),
});
export const githubAttentionItem = attentionEvidenceItem.extend({
  source: z.literal('github'),
  projectId: teamId,
  project: z.string().min(1).max(140),
  state: attentionBucket,
  changed: z.boolean(),
  forYou: z.boolean(),
  decidedAt: z.iso.datetime().nullable(),
  until: z.iso.datetime().nullable(),
});
export const localAttentionEvidenceItem = z.strictObject({
  id: digest,
  revision: digest,
  kind: z.enum(['local-only', 'forgotten-work']),
  priority: z.enum(['review', 'cleanup']),
  title: z.string().min(1).max(8192),
  branch: z.string().max(512),
  branchKey: digest,
  localSha: z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/),
  deviceId: teamId,
  tools: z.array(z.enum(['codex', 'claude-code', 'cursor', 'other', 'unknown'])).max(5),
  evidence: z.array(z.string().min(1).max(400)).min(1).max(4),
  observedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
  signals: attentionSignals,
});
export const storedLocalAttentionProjection = z.strictObject({
  version: z.literal(1),
  observedAt: z.iso.datetime(),
  counts: z.strictObject({
    findings: z.number().int().nonnegative().max(1_000),
    localOnly: z.number().int().nonnegative().max(1_000),
    forgottenWork: z.number().int().nonnegative().max(1_000),
  }),
  items: z.array(localAttentionEvidenceItem).max(100),
  omitted: z.number().int().nonnegative().max(1_000),
});
export const localAttentionItem = localAttentionEvidenceItem.extend({
  source: z.literal('local'),
  projectId: teamId,
  project: z.string().min(1).max(140),
  memberId: teamId,
  person: z.string().min(1).max(512),
  device: z.string().min(1).max(512),
  state: attentionBucket,
  changed: z.boolean(),
  forYou: z.boolean(),
  decidedAt: z.iso.datetime().nullable(),
  until: z.iso.datetime().nullable(),
});
export const attentionItem = z.discriminatedUnion('source', [
  githubAttentionItem,
  localAttentionItem,
]);
const counts = z.strictObject({
  active: z.number().int().nonnegative().max(50_000),
  snoozed: z.number().int().nonnegative().max(50_000),
  dismissed: z.number().int().nonnegative().max(50_000),
});
export const attentionPage = z.strictObject({
  workspaceId: teamId,
  revision: z.string().regex(/^\d+$/),
  checkedAt: z.iso.datetime(),
  bucket: attentionBucket,
  queue: counts,
  signals: z.strictObject({
    failingChecks: z.number().int().nonnegative().max(2_650_000),
    reviewRequested: z.number().int().nonnegative().max(2_650_000),
    staleDrafts: z.number().int().nonnegative().max(2_650_000),
    mergedBranches: z.number().int().nonnegative().max(2_650_000),
    localOnly: z.number().int().nonnegative().max(1_000_000),
    forgottenWork: z.number().int().nonnegative().max(1_000_000),
  }),
  sources: z.number().int().nonnegative().max(1_000_000),
  pendingSources: z.number().int().nonnegative().max(1_000_000),
  failedSources: z.number().int().nonnegative().max(1_000_000),
  staleSources: z.number().int().nonnegative().max(1_000_000),
  items: z.array(attentionItem).max(100),
  omitted: z.number().int().nonnegative().max(10_000_000),
});
export const attentionDecisionCommand = z
  .strictObject({
    choice: z.enum(['snoozed', 'dismissed', 'restore']),
    items: z
      .array(z.strictObject({ source: z.enum(['github', 'local']), id: digest, revision: digest }))
      .min(1)
      .max(100),
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.source + ':' + item.id)).size === value.items.length,
  );

export type AttentionBucket = z.infer<typeof attentionBucket>;
export type AttentionKind = z.infer<typeof attentionKind>;
export type AttentionEvidenceItem = z.infer<typeof attentionEvidenceItem>;
export type StoredAttentionProjection = z.infer<typeof storedAttentionProjection>;
export type LocalAttentionEvidenceItem = z.infer<typeof localAttentionEvidenceItem>;
export type StoredLocalAttentionProjection = z.infer<typeof storedLocalAttentionProjection>;
export type AttentionItem = z.infer<typeof attentionItem>;
export type AttentionPage = z.infer<typeof attentionPage>;
export type AttentionDecisionCommand = z.infer<typeof attentionDecisionCommand>;
