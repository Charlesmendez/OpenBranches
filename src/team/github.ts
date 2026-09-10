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
