import { z } from 'zod';
import type { GitHubHttp } from './http';
import type { RemoteSnapshot } from './reader';

const text = z.string().max(8192);
const sourceActor = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().min(1).max(200),
  type: z.string().max(100).optional(),
});
export const actorSchema = z.object({
  id: z.string().min(1).max(100),
  login: z.string().min(1).max(200),
  kind: z.enum(['user', 'bot', 'organization', 'unknown']),
});
export const teamSchema = z.object({ id: z.string().min(1).max(100), name: text, slug: text });
const pullSchema = z.object({
  number: z.number().int().positive().safe(),
  title: text,
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable(),
  updated_at: text,
  user: sourceActor.nullish(),
  requested_reviewers: z.array(sourceActor).max(100).optional(),
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
});
export type CachedPull = z.infer<typeof cachedPullSchema>;
const actor = (value: z.infer<typeof sourceActor>): z.infer<typeof actorSchema> => ({
  id: String(value.id),
  login: value.login,
  kind:
    value.type === 'User'
      ? 'user'
      : value.type === 'Bot'
        ? 'bot'
        : value.type === 'Organization'
          ? 'organization'
          : 'unknown',
});
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
      ...(pr.user ? { author: actor(pr.user) } : {}),
      ...(pr.requested_reviewers ? { requestedReviewers: pr.requested_reviewers.map(actor) } : {}),
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
export async function readPulls(http: GitHubHttp, repository: string, isCurrent = () => true) {
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
