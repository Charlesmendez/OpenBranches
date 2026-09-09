import { z } from 'zod';
import type { GitHubHttp } from './http';
import { cachedPullSchema, readPulls } from './pulls';
import { historySchema, readHistory, type HistoryOptions } from './history';

export function githubRepository(remoteUrl: string): string | undefined {
  const scp = /^(?:git@)?github\.com:([^/]+\/[^/]+?)\/?$/.exec(remoteUrl);
  let path = scp?.[1];
  if (!path) {
    try {
      const url = new URL(remoteUrl);
      if (url.hostname !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol)) return;
      path = url.pathname.slice(1).replace(/\/$/, '');
    } catch {
      return;
    }
  }
  path = path.replace(/\.git$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(path) ? path : undefined;
}

const branchSchema = z.object({
  name: z.string(),
  commit: z.object({ sha: z.string().regex(/^[a-f\d]{40,64}$/i) }),
});
const cachedText = z.string().max(8192);
export const remoteSnapshotSchema = z.object({
  repository: cachedText,
  remoteName: cachedText,
  branches: z.array(z.object({ name: cachedText, sha: cachedText })).max(5000),
  pulls: z.array(cachedPullSchema).max(5300),
  openPullsComplete: z.boolean().optional(),
  checkedAt: cachedText,
  branchesComplete: z.boolean(),
  pullHistoryComplete: z.boolean(),
  error: cachedText.optional(),
  history: historySchema.optional(),
});
export type RemoteSnapshot = z.infer<typeof remoteSnapshotSchema>;

/** Paginate branches completely up to a visible resource bound. Pull-request
 * history is deliberately bounded and never used to prove that no PR exists. */
export async function readRemote(
  http: GitHubHttp,
  repository: string,
  remoteName: string,
  options: HistoryOptions = {},
): Promise<RemoteSnapshot> {
  // A multi-page snapshot is observed over an interval, not atomically. Use
  // its earliest observation so slow comparisons never make old refs look new.
  const checkedAt = new Date().toISOString();
  const assertCurrent = () => {
    if (options.isCurrent?.() === false) throw new Error('GitHub refresh was cancelled.');
  };
  const prefix = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  const branches: RemoteSnapshot['branches'] = [];
  let branchesComplete = false;
  for (let page = 1; page <= 50; page++) {
    assertCurrent();
    const response = await http.get(`${prefix}/branches?per_page=100&page=${page}`);
    branches.push(
      ...z
        .array(branchSchema)
        .parse(response.body)
        .map((b) => ({ name: b.name, sha: b.commit.sha.toLowerCase() })),
    );
    if (!response.hasNext) {
      branchesComplete = true;
      break;
    }
  }
  const pullIndex = await readPulls(http, repository, () => options.isCurrent?.() !== false);
  const history = await readHistory(http, repository, branches, options);
  return {
    repository,
    remoteName,
    branches,
    ...pullIndex,
    branchesComplete,
    checkedAt,
    history,
  };
}
