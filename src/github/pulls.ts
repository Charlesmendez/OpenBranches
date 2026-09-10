import { z } from 'zod';
import type { GitHubReader } from './transport';
import type { RemoteSnapshot } from './reader';
import { actorSchema, parseActor, sourceActorSchema } from './actors';
import { pullSignalsSchema } from './signalsSchema';

const text = z.string().max(8192);
export const teamSchema = z.object({ id: z.string().min(1).max(100), name: text, slug: text });
const pullSchema = z.object({
  number: z.number().int().positive().safe(),
  title: text,
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable(),
  updated_at: text,
  user: sourceActorSchema.nullish(),
  requested_reviewers: z.array(sourceActorSchema).max(100).optional(),
  requested_teams: z
    .array(z.object({ id: z.number().int().positive().safe(), name: text, slug: text }))
    .max(100)
    .optional(),
  base: z.object({ ref: text }),
  head: z.object({
    ref: text,
    sha: z.string().regex(/^[a-f\d]{40,64}$/i),
    repo: z.object({ full_name: text }).nullable(),
  }),
});
export const cachedPullSchema = z.object({
  observedAt: text.optional(),
  retained: z.boolean().optional(),
  number: z.number().int().positive(),
  title: text,
  url: text,
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean().optional(),
  base: text,
  headSha: text,
  updatedAt: text,
  headName: text,
  headRepository: text.nullable(),
  author: actorSchema.optional(),
  requestedReviewers: z.array(actorSchema).max(100).optional(),
  requestedTeams: z.array(teamSchema).max(100).optional(),
  signals: pullSignalsSchema.optional(),
});
export type CachedPull = z.infer<typeof cachedPullSchema>;

/** Merge bounded listings and exact-SHA results without letting an older
 * observation replace a newer PR state. */
export function mergeCachedPulls(...collections: CachedPull[][]): CachedPull[] {
  const pulls = new Map<number, CachedPull>();
  for (const collection of collections)
    for (const pull of collection) {
      const previous = pulls.get(pull.number);
      if (!previous || pull.updatedAt >= previous.updatedAt) pulls.set(pull.number, pull);
    }
  return [...pulls.values()];
}

/** Open work remains complete and exact branch-tip matches take precedence
 * over unrelated closed history when the persisted source reaches its cap. */
export function limitCachedPulls(
  pulls: CachedPull[],
  exact: CachedPull[] = [],
  limit = 5300,
): CachedPull[] {
  const exactNumbers = new Set(exact.map((pull) => pull.number));
  return [...pulls]
    .sort(
      (a, b) =>
        Number(b.state === 'open') - Number(a.state === 'open') ||
        Number(exactNumbers.has(b.number)) - Number(exactNumbers.has(a.number)) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.number - a.number,
    )
    .slice(0, limit);
}

export function parsePulls(body: unknown, repository: string): CachedPull[] {
  return z
    .array(pullSchema)
    .max(100)
    .parse(body)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${repository}/pull/${pr.number}`,
      state: pr.merged_at ? 'merged' : pr.state,
      draft: pr.draft,
      base: pr.base.ref,
      headSha: pr.head.sha.toLowerCase(),
      headName: pr.head.ref,
      headRepository: pr.head.repo?.full_name ?? null,
      updatedAt: pr.updated_at,
      ...(pr.user ? { author: parseActor(pr.user) } : {}),
      ...(pr.requested_reviewers
        ? { requestedReviewers: pr.requested_reviewers.map(parseActor) }
        : {}),
      ...(pr.requested_teams
        ? {
            requestedTeams: pr.requested_teams.map((team) => ({
              id: String(team.id),
              name: team.name,
              slug: team.slug,
            })),
          }
        : {}),
    }));
}

// Open work has its own listing so recent closed PRs cannot hide older drafts.
// Missing heads still have useful PR metadata; they are never assigned by name alone.
export async function readPulls(http: GitHubReader, repository: string, isCurrent = () => true) {
  const pulls = new Map<number, CachedPull>();
  const prefix = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  let openPullsComplete = false;
  let closedComplete = false;
  const deadline = Date.now() + 30_000;
  for (const [state, pages] of [
    ['open', 50],
    ['closed', 3],
  ] as const) {
    for (let page = 1; page <= pages; page++) {
      if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
      if (Date.now() >= deadline) break;
      const response = await http.get(
        `${prefix}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`,
      );
      if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
      for (const pr of parsePulls(response.body, repository)) {
        const previous = pulls.get(pr.number);
        // The later response can observe a PR closing during pagination.
        if (!previous || pr.updatedAt >= previous.updatedAt) pulls.set(pr.number, pr);
      }
      if (!response.hasNext) {
        if (state === 'open') openPullsComplete = true;
        else closedComplete = true;
        break;
      }
    }
  }
  return {
    pulls: [...pulls.values()],
    openPullsComplete,
    pullHistoryComplete: openPullsComplete && closedComplete,
  };
}

/** A partial listing cannot prove older PRs disappeared. Keep their original
 * observation time and mark them retained, within the existing cache bound. */
export function retainPartialPulls(
  fresh: RemoteSnapshot,
  previous?: RemoteSnapshot,
): RemoteSnapshot {
  const pulls = new Map(
    fresh.pulls.map((pull) => [
      pull.number,
      { ...pull, observedAt: pull.observedAt ?? fresh.checkedAt, retained: false },
    ]),
  );
  for (const pull of previous?.pulls ?? []) {
    if (pulls.size >= 5300) break;
    if (pulls.has(pull.number)) continue;
    if (pull.state === 'open' ? fresh.openPullsComplete : fresh.pullHistoryComplete) continue;
    pulls.set(pull.number, {
      ...pull,
      observedAt: pull.observedAt ?? previous!.checkedAt,
      retained: true,
    });
  }
  return { ...fresh, pulls: [...pulls.values()] };
}
