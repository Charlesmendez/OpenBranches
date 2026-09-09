import { z } from 'zod';

export const githubId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
const numericId = z.number().int().positive().safe();
const login = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i);
const name = z
  .string()
  .regex(/^[\w.-]{1,100}$/)
  .refine((v) => v !== '.' && v !== '..');
export const installationBinding = z.strictObject({
  installationId: githubId,
  accountId: githubId,
  accountType: z.enum(['User', 'Organization']),
});
export type InstallationBinding = z.infer<typeof installationBinding>;
export const permissionsSchema = z.record(z.string().max(100), z.enum(['read', 'write', 'admin']));
export const installationSchema = z.object({
  id: numericId,
  account: z.object({ id: numericId, login, type: z.enum(['User', 'Organization']) }),
  suspended_at: z.iso.datetime().nullable(),
  permissions: permissionsSchema,
  client_id: z.string().max(100).optional(),
});
export const repositorySchema = z.object({
  id: numericId,
  name,
  full_name: z.string().max(140),
  owner: z.object({ id: numericId, login, type: z.enum(['User', 'Organization']) }),
  private: z.boolean(),
  archived: z.boolean(),
  default_branch: z.string().max(8192),
});
export const repositoryPageSchema = z.object({
  total_count: z.number().int().nonnegative().safe(),
  repositories: z.array(repositorySchema).max(100),
});
export const installationTokenSchema = z.object({
  token: z.string().min(1).max(8192),
  expires_at: z.iso.datetime(),
  permissions: permissionsSchema,
});
export interface GitHubProject {
  id: string;
  name: string;
  fullName: string;
  accountId: string;
  accountLogin: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
}
export function project(
  value: z.infer<typeof repositorySchema>,
  binding: InstallationBinding,
): GitHubProject {
  if (
    String(value.owner.id) !== binding.accountId ||
    value.owner.type !== binding.accountType ||
    value.full_name !== value.owner.login + '/' + value.name
  )
    throw new Error('The GitHub repository identity changed. Review the connection again.');
  return {
    id: String(value.id),
    name: value.name,
    fullName: value.full_name,
    accountId: String(value.owner.id),
    accountLogin: value.owner.login,
    private: value.private,
    archived: value.archived,
    defaultBranch: value.default_branch,
  };
}
