import { z } from 'zod';
import type { GitHubAppInstallation } from '../domain/types';
import type { GitHubReader } from './transport';

const installationsSchema = z.object({
  installations: z
    .array(
      z.object({
        account: z.object({
          login: z.string().min(1).max(100),
          type: z.enum(['User', 'Organization']),
        }),
        repository_selection: z.enum(['all', 'selected']),
      }),
    )
    .max(100),
});

export interface InstallationSnapshot {
  installations: GitHubAppInstallation[];
  checkedAt: string;
  etag?: string;
  partial: boolean;
}

/** One bounded conditional request identifies every owner on which this
 * GitHub App is installed for the signed-in user. */
export async function readInstallations(
  http: GitHubReader,
  previous?: InstallationSnapshot,
): Promise<InstallationSnapshot> {
  const response = await http.get('/user/installations?per_page=100', {
    etag: previous?.etag,
  });
  if (response.notModified && previous) return { ...previous, checkedAt: new Date().toISOString() };
  const body = installationsSchema.parse(response.body);
  return {
    installations: body.installations
      .map((installation) => ({
        account: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
      }))
      .sort((left, right) => left.account.localeCompare(right.account)),
    checkedAt: new Date().toISOString(),
    ...(response.etag ? { etag: response.etag } : {}),
    partial: response.hasNext,
  };
}
