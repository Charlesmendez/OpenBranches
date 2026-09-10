import { z } from 'zod';
import type { Repository } from '../domain/types';
import { integrationTargetNames } from '../domain/integrationTargets';
import { parsePulls, type CachedPull } from './pulls';
import { GitHubError, type GitHubReader } from './transport';

const sha = z.string().regex(/^[a-f\d]{40,64}$/);
export const pullLookupSchema = z.object({
  headSha: sha,
  checkedAt: z.iso.datetime(),
  complete: z.boolean(),
  found: z.boolean(),
  nextPage: z.number().int().min(2).max(100).optional(),
  retryAt: z.number().finite().optional(),
  error: z.string().max(8192).optional(),
});
export type PullLookup = z.infer<typeof pullLookupSchema>;

export interface PullLookupBudget {
  remaining: number;
  milliseconds: number;
}

export interface PullLookupOptions {
  previous?: PullLookup[];
  budget: PullLookupBudget;
  isCurrent?: () => boolean;
}

type RemoteBranch = { name: string; sha: string };

/** Exact SHAs that still lack PR evidence. Local branches are considered only
 * when their upstream or saved remote belongs to this GitHub source. */
export function missingPullHeads(
  branches: RemoteBranch[],
  pulls: CachedPull[],
  remoteName: string,
  local?: Repository,
): string[] {
  const targets = new Set<string>(integrationTargetNames(local?.targets));
  const covered = new Set(pulls.map((pull) => pull.headSha));
  const candidates = new Set<string>();
  const add = (name: string, value?: string) => {
    if (!targets.has(name) && value && sha.safeParse(value).success && !covered.has(value))
      candidates.add(value);
  };
  for (const branch of branches) add(branch.name, branch.sha);
  for (const branch of local?.branches ?? []) {
    const belongs =
      branch.remote?.remote === remoteName ||
      branch.local?.upstream?.startsWith(`refs/remotes/${remoteName}/`) === true;
    if (belongs) add(branch.name, branch.local?.sha);
  }
  return [...candidates];
}

const retryDelay = (found: boolean) => (found ? 60 * 60_000 : 10 * 60_000);
const lookupError = (failure: unknown) =>
  failure instanceof GitHubError
    ? failure.message
    : 'Some exact pull-request checks are unavailable. They will retry automatically.';

/** Incrementally resolve old PRs by immutable branch tip. One response page is
 * read per SHA per refresh; cursors let unusual 100+ association sets finish
 * later without monopolizing the workspace budget. */
export async function readPullLookups(
  http: GitHubReader,
  repository: string,
  headShas: string[],
  options: PullLookupOptions,
): Promise<{ pulls: CachedPull[]; lookups: PullLookup[] }> {
  const previous = new Map(options.previous?.map((item) => [item.headSha, item]));
  const lookups = new Map<string, PullLookup>();
  const candidates = [...new Set(headShas)]
    .filter((value) => sha.safeParse(value).success)
    .slice(0, 10_000);
  for (const headSha of candidates) {
    const cached = previous.get(headSha);
    if (cached) lookups.set(headSha, cached);
  }
  const now = Date.now();
  const queue = candidates
    .filter((headSha) => {
      const cached = previous.get(headSha);
      return !cached || !cached.retryAt || cached.retryAt <= now;
    })
    .sort((a, b) => {
      const left = previous.get(a),
        right = previous.get(b);
      return (
        Number(!!left) - Number(!!right) ||
        Number(left?.complete ?? false) - Number(right?.complete ?? false) ||
        (left?.checkedAt ?? '').localeCompare(right?.checkedAt ?? '') ||
        a.localeCompare(b)
      );
    });
  const pulls: CachedPull[] = [];
  const prefix = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  for (const headSha of queue) {
    if (options.isCurrent?.() === false) throw new Error('GitHub refresh was cancelled.');
    if (options.budget.remaining <= 0 || options.budget.milliseconds <= 0) break;
    const cached = previous.get(headSha);
    const page = cached && !cached.complete ? (cached.nextPage ?? 1) : 1;
    options.budget.remaining--;
    const startedAt = Date.now();
    try {
      const response = await http.get(
        `${prefix}/commits/${headSha}/pulls?per_page=100&page=${page}`,
      );
      if (options.isCurrent?.() === false) throw new Error('GitHub refresh was cancelled.');
      // GitHub may return a PR whose current head moved beyond the queried
      // commit. Keep only an exact head so branch attachment stays truthful.
      const found = parsePulls(response.body, repository).filter(
        (pull) => pull.headSha === headSha,
      );
      pulls.push(...found);
      const complete = !response.hasNext;
      const foundAny = (page > 1 && cached?.found === true) || found.length > 0;
      lookups.set(headSha, {
        headSha,
        checkedAt: new Date(startedAt).toISOString(),
        complete,
        found: foundAny,
        ...(complete
          ? { retryAt: Date.now() + retryDelay(foundAny) }
          : { nextPage: Math.min(100, page + 1) }),
      });
    } catch (failure) {
      if (options.isCurrent?.() === false) throw new Error('GitHub refresh was cancelled.');
      lookups.set(headSha, {
        headSha,
        checkedAt: new Date(startedAt).toISOString(),
        complete: false,
        found: cached?.found ?? false,
        nextPage: page > 1 ? page : undefined,
        retryAt: Date.now() + 10 * 60_000,
        error: lookupError(failure),
      });
      if (!(failure instanceof GitHubError) || ![404, 409, 422].includes(failure.status)) break;
    } finally {
      options.budget.milliseconds -= Math.max(0, Date.now() - startedAt);
    }
  }
  return { pulls, lookups: [...lookups.values()] };
}
