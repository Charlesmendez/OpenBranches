import { z } from 'zod';
import type { Repository, Target } from '../domain/types';
import { integrationTargetNames, standardIntegrationNames } from '../domain/integrationTargets';
import { GitHubError, type GitHubReader } from './transport';

export const integrationNames = standardIntegrationNames;
const sha = z.string().regex(/^[a-f\d]{40,64}$/);
export const historyCheckSchema = z.object({
  branchSha: sha,
  targetSha: sha,
  state: z.enum(['integrated', 'pending', 'unknown']),
  checkedAt: z.iso.datetime(),
  source: z.enum(['git', 'github', 'identical']),
  retryAt: z.number().finite().optional(),
});
export type HistoryCheck = z.infer<typeof historyCheckSchema>;
export const historySchema = z.object({
  checks: z.array(historyCheckSchema).max(20_000),
  error: z.string().max(8192).optional(),
});
export type RemoteHistory = z.infer<typeof historySchema>;
type RemoteBranch = { name: string; sha: string };
export interface HistoryBudget {
  remaining: number;
  milliseconds: number;
}
export interface HistoryOptions {
  previous?: RemoteHistory;
  local?: Repository;
  budget?: HistoryBudget;
  isCurrent?: () => boolean;
}
export const historyKey = (branchSha: string, targetSha: string) => `${branchSha}:${targetSha}`;
export function publishedTargets(
  branches: RemoteBranch[],
  preferred?: readonly Target[],
): RemoteBranch[] {
  return integrationTargetNames(preferred).flatMap((name) => {
    const target = branches.find((branch) => branch.name === name);
    return target ? [target] : [];
  });
}

const comparisonSchema = z.object({
  status: z.enum(['ahead', 'behind', 'identical', 'diverged']),
  ahead_by: z.number().int().nonnegative(),
  behind_by: z.number().int().nonnegative(),
  base_commit: z.object({ sha }),
  merge_base_commit: z.object({ sha }),
});

/** BASE is the target and HEAD is the branch. Only identical or behind HEADs
 * are ancestors of BASE. Never use a paginated commit list to prove absence. */
export function comparisonState(body: unknown, branchSha: string, targetSha: string) {
  const result = comparisonSchema.parse(body);
  if (result.base_commit.sha !== targetSha) throw new Error('Comparison target changed.');
  const consistent =
    result.status === 'identical'
      ? branchSha === targetSha && result.ahead_by === 0 && result.behind_by === 0
      : result.status === 'behind'
        ? result.ahead_by === 0 &&
          result.behind_by > 0 &&
          result.merge_base_commit.sha === branchSha
        : result.status === 'ahead'
          ? result.ahead_by > 0 &&
            result.behind_by === 0 &&
            result.merge_base_commit.sha === targetSha
          : result.ahead_by > 0 && result.behind_by > 0;
  if (!consistent) throw new Error('Comparison evidence is inconsistent.');
  return result.status === 'behind' || result.status === 'identical' ? 'integrated' : 'pending';
}

function localChecks(repository?: Repository): Map<string, HistoryCheck> {
  const checks = new Map<string, HistoryCheck>();
  if (!repository || repository.error) return checks;
  for (const branch of repository.branches) {
    for (const [ref, states] of [
      [branch.local, branch.integration],
      [branch.remote, branch.local ? branch.remoteIntegration : branch.integration],
    ] as const) {
      if (!ref || !states) continue;
      for (const target of repository.targets) {
        const state = states[target.name];
        if (!state || state === 'unknown' || (repository.shallow && state === 'pending')) continue;
        checks.set(historyKey(ref.sha, target.sha), {
          branchSha: ref.sha,
          targetSha: target.sha,
          state,
          checkedAt: repository.scannedAt,
          source: 'git',
        });
      }
    }
  }
  return checks;
}

/** Incremental, immutable-SHA comparisons. Reuse exact local/cache evidence,
 * deduplicate aliases, prune obsolete pairs, and visit unchecked work before
 * failed retries. One bad pair must not prevent later branches being checked. */
export async function readHistory(
  http: GitHubReader,
  repository: string,
  branches: RemoteBranch[],
  options: HistoryOptions = {},
): Promise<RemoteHistory> {
  const budget = options.budget ?? { remaining: 12, milliseconds: 30_000 };
  const previous = new Map(
    options.previous?.checks.map((check) => [historyKey(check.branchSha, check.targetSha), check]),
  );
  const local = localChecks(options.local);
  const checks = new Map<string, HistoryCheck>();
  const queue = new Map<string, { branchSha: string; targetSha: string }>();
  for (const target of publishedTargets(branches, options.local?.targets)) {
    for (const branch of branches) {
      const key = historyKey(branch.sha, target.sha);
      if (checks.has(key) || queue.has(key)) continue;
      const cached = previous.get(key);
      if (branch.sha === target.sha) {
        checks.set(key, {
          branchSha: branch.sha,
          targetSha: target.sha,
          state: 'integrated',
          checkedAt: new Date().toISOString(),
          source: 'identical',
        });
      } else if (cached && cached.state !== 'unknown') {
        checks.set(key, cached);
      } else if (local.has(key)) {
        checks.set(key, local.get(key)!);
      } else {
        if (cached) checks.set(key, cached);
        if (!cached?.retryAt || cached.retryAt <= Date.now())
          queue.set(key, { branchSha: branch.sha, targetSha: target.sha });
      }
    }
  }
  let error: string | undefined;
  const work = [...queue].sort(([a], [b]) => Number(previous.has(a)) - Number(previous.has(b)));
  const prefix = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  for (const [key, pair] of work) {
    if (budget.remaining <= 0 || budget.milliseconds <= 0 || options.isCurrent?.() === false) break;
    budget.remaining--;
    const startedAt = Date.now();
    try {
      // Page two omits changed files/patches. The summary covers the complete
      // comparison even when the returned commit page is empty or truncated.
      const response = await http.get(
        `${prefix}/compare/${pair.targetSha}...${pair.branchSha}?per_page=1&page=2`,
      );
      if (options.isCurrent?.() === false) break;
      checks.set(key, {
        ...pair,
        state: comparisonState(response.body, pair.branchSha, pair.targetSha),
        checkedAt: new Date().toISOString(),
        source: 'github',
      });
    } catch (failure) {
      if (options.isCurrent?.() === false) break;
      error =
        failure instanceof GitHubError && [401, 403, 429].includes(failure.status)
          ? failure.message
          : 'Some GitHub history checks are unavailable. They will retry automatically.';
      checks.set(key, {
        ...pair,
        state: 'unknown',
        checkedAt: new Date().toISOString(),
        source: 'github',
        retryAt: Date.now() + 600_000,
      });
      if (!(failure instanceof GitHubError) || ![404, 409, 422].includes(failure.status)) break;
    } finally {
      budget.milliseconds -= Math.max(0, Date.now() - startedAt);
    }
  }
  return { checks: [...checks.values()], error };
}
