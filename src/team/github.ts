import { z } from 'zod';
import { teamId } from './protocol';

export const githubNumericId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
export const githubInstallation = z.strictObject({
  installationId: githubNumericId,
  accountId: githubNumericId,
  accountType: z.enum(['User', 'Organization']),
  accountLogin: z.string().min(1).max(100),
});
export const githubProject = z.strictObject({
  id: githubNumericId,
  name: z.string().min(1).max(100),
  fullName: z.string().min(1).max(140),
  accountId: githubNumericId,
  accountLogin: z.string().min(1).max(100),
  private: z.boolean(),
  archived: z.boolean(),
  defaultBranch: z.string().max(8192),
});
export const githubProof = z.strictObject({
  id: teamId,
  expiresAt: z.iso.datetime(),
  complete: z.boolean(),
  installations: z.array(githubInstallation).max(50),
});
export const githubCatalog = z.strictObject({
  id: teamId,
  workspaceId: teamId,
  proofId: teamId,
  expiresAt: z.iso.datetime(),
  installation: githubInstallation,
  projects: z.array(githubProject).max(1000),
  complete: z.boolean(),
  total: z.number().int().nonnegative(),
});
export const githubSetupState = z.strictObject({
  workspaceId: teamId,
  configured: z.boolean(),
  proof: githubProof.optional(),
  selections: z
    .array(
      z.strictObject({
        projectId: teamId,
        repositoryId: githubNumericId,
        fullName: z.string().max(140),
        accountLogin: z.string().max(100),
        selectedAt: z.iso.datetime(),
        lastAttemptAt: z.iso.datetime().nullable(),
        snapshotAt: z.iso.datetime().nullable(),
        syncState: z.enum(['waiting', 'current', 'partial', 'error']),
        branchCount: z.number().int().nonnegative().max(5000),
        pullCount: z.number().int().nonnegative().max(5300),
        openPullCount: z.number().int().nonnegative().max(5000),
      }),
    )
    .max(500),
});
export const githubSelection = z
  .strictObject({
    reviewId: teamId,
    repositoryIds: z.array(githubNumericId).min(1).max(100),
  })
  .refine((v) => new Set(v.repositoryIds).size === v.repositoryIds.length);
export type GitHubInstallation = z.infer<typeof githubInstallation>;
export type GitHubCatalog = z.infer<typeof githubCatalog>;
export type GitHubSetupState = z.infer<typeof githubSetupState>;

const githubText = z.string().max(8192);
const githubSha = z.string().regex(/^[a-f\d]{40,64}$/);
const githubActor = z.strictObject({
  id: githubNumericId,
  login: z.string().min(1).max(200),
  kind: z.enum(['user', 'bot', 'organization', 'unknown']),
});
const githubTarget = z.strictObject({
  name: githubText,
  sha: githubSha,
  state: z.enum(['integrated', 'pending', 'unknown']),
  checkedAt: z.iso.datetime().nullable(),
});
export const githubWorkBranch = z.strictObject({
  name: githubText,
  sha: githubSha,
  targets: z.array(githubTarget).max(4),
  pullNumbers: z.array(z.number().int().positive().safe()).max(100),
});
export const githubWorkPull = z.strictObject({
  number: z.number().int().positive().safe(),
  title: githubText,
  url: z.string().url().max(8192),
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  retained: z.boolean(),
  base: githubText,
  headName: githubText,
  headSha: githubSha,
  updatedAt: z.iso.datetime(),
  author: githubActor.optional(),
  requestedReviewers: z.array(githubActor).max(100),
  requestedTeams: z
    .array(z.strictObject({ id: githubNumericId, name: githubText, slug: githubText }))
    .max(100),
  checks: z.strictObject({
    state: z.enum(['failed', 'pending', 'passed', 'other', 'unknown']),
    label: z.string().min(1).max(160),
  }),
});
export const githubWorkSource = z.strictObject({
  projectId: teamId,
  repositoryId: githubNumericId,
  fullName: z.string().min(1).max(140),
  lastAttemptAt: z.iso.datetime().nullable(),
  snapshotAt: z.iso.datetime(),
  syncState: z.enum(['current', 'partial', 'error']),
  branchesComplete: z.boolean(),
  pullHistoryComplete: z.boolean(),
  branchCount: z.number().int().nonnegative().max(5000),
  pullCount: z.number().int().nonnegative().max(5300),
  openPullCount: z.number().int().nonnegative().max(5000),
  branches: z.array(githubWorkBranch).max(200),
  pulls: z.array(githubWorkPull).max(200),
  omittedBranches: z.number().int().nonnegative().max(5000),
  omittedPulls: z.number().int().nonnegative().max(5300),
});
export const githubWorkPage = z.strictObject({
  workspaceId: teamId,
  revision: z.string().regex(/^\d+$/),
  checkedAt: z.iso.datetime(),
  sources: z.array(githubWorkSource).max(10),
  nextCursor: teamId.nullable(),
});
export type GitHubWorkPage = z.infer<typeof githubWorkPage>;
export type GitHubWorkSource = z.infer<typeof githubWorkSource>;
