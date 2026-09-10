import type { Branch, CodingTool, GitHubActor, GitHubPullRequest, Repository } from './types';
import { agentSearchText, branchTools } from './agents';
import { hasFailedChecks } from './pullSignals';
import { pullSourceStale } from './sourceFreshness';
export { pullSourceStale } from './sourceFreshness';

export interface PullWork {
  id: string;
  pull: GitHubPullRequest;
  links: { repositoryId: string; branchId: string; branch: Branch }[];
  projects: string[];
}
export interface PersonWork {
  id: string;
  actor?: GitHubActor;
  authored: number;
  requested: number;
  drafts: number;
}
export type PullFilter = 'open' | 'requested' | 'failed-checks' | 'quiet-drafts' | 'history';
export type PullAttentionKind = 'failed-checks' | 'review-requested' | 'quiet-draft';
export interface PullAttentionCue {
  kind: PullAttentionKind;
  label: string;
  detail: string;
}
export type PullScope = {
  query: string;
  person: string | null;
  project: string;
  tool: string;
};
export const pullKey = (pull: Pick<GitHubPullRequest, 'repository' | 'number'>) =>
  `${pull.repository.toLowerCase()}#${pull.number}`;
export const reviewRequested = (pull: GitHubPullRequest) =>
  pull.state === 'open' &&
  !!((pull.requestedReviewers?.length ?? 0) + (pull.requestedTeams?.length ?? 0));
export const quietDraft = (pull: GitHubPullRequest, now = Date.now()) =>
  pull.state === 'open' &&
  !!pull.draft &&
  Number.isFinite(Date.parse(pull.updatedAt)) &&
  now - Date.parse(pull.updatedAt) >= 14 * 86_400_000;

/** Small, evidence-backed reasons for putting an open PR near the top. */
export function pullAttentionCues(pull: GitHubPullRequest, now = Date.now()): PullAttentionCue[] {
  if (pull.state !== 'open') return [];
  const cues: PullAttentionCue[] = [];
  if (hasFailedChecks(pull, now)) {
    const count = pull.signals?.checks?.counts.failed ?? 0;
    cues.push({
      kind: 'failed-checks',
      label: 'Checks need attention',
      detail: count
        ? `${count} ${count === 1 ? 'failure' : 'failures'} reported`
        : 'Failure reported',
    });
  }
  if (reviewRequested(pull)) {
    const people = pull.requestedReviewers?.length ?? 0;
    const teams = pull.requestedTeams?.length ?? 0;
    const count = people + teams;
    cues.push({
      kind: 'review-requested',
      label: 'Review requested',
      detail: `${count} ${count === 1 ? 'person or team' : 'people or teams'}`,
    });
  }
  if (quietDraft(pull, now)) {
    const days = Math.floor((now - Date.parse(pull.updatedAt)) / 86_400_000);
    cues.push({
      kind: 'quiet-draft',
      label: 'Quiet draft',
      detail: `${days} days without a PR update`,
    });
  }
  return cues;
}

export const pullAttentionRank = (pull: GitHubPullRequest, now = Date.now()) =>
  hasFailedChecks(pull, now) ? 0 : reviewRequested(pull) ? 1 : quietDraft(pull, now) ? 2 : 3;
export const preferPullEvidence = (candidate: GitHubPullRequest, current?: GitHubPullRequest) =>
  !current ||
  candidate.observedAt > current.observedAt ||
  (candidate.observedAt === current.observedAt &&
    ((!!current.retained && !candidate.retained) ||
      (!!current.retained === !!candidate.retained &&
        !!current.sourceError &&
        !candidate.sourceError)));

/** PR metadata and check/review reads have independent clocks. A newer PR
 * listing from another clone must not erase a useful exact-head observation. */
export function mergePullEvidence(
  candidate: GitHubPullRequest,
  current?: GitHubPullRequest,
): GitHubPullRequest {
  const preferred = preferPullEvidence(candidate, current) ? candidate : current!;
  const source = [candidate, current]
    .filter(
      (pull): pull is GitHubPullRequest =>
        !!pull &&
        pull.signals?.headSha === preferred.headSha &&
        !!(pull.signals.checks || pull.signals.reviews),
    )
    .sort((a, b) => b.signals!.attemptedAt.localeCompare(a.signals!.attemptedAt))[0];
  if (!source) return preferred;
  const signals = source.signals!;
  return {
    ...preferred,
    signals: source.sourceError
      ? {
          ...signals,
          checks: signals.checks ? { ...signals.checks, error: source.sourceError } : undefined,
          reviews: signals.reviews ? { ...signals.reviews, error: source.sourceError } : undefined,
        }
      : signals,
  };
}
export const pullInvolvesPerson = (pull: GitHubPullRequest, person: string | null) =>
  person === null ||
  (pull.author?.id ?? 'unknown-author') === person ||
  (pull.state === 'open' && !!pull.requestedReviewers?.some((actor) => actor.id === person));

export function collaborationIndex(repositories: Repository[]): PullWork[] {
  const work = new Map<string, PullWork>();
  for (const repository of repositories) {
    const branchLinks = new Map<string, PullWork['links']>();
    for (const branch of repository.branches) {
      if (!branch.pullRequest) continue;
      const key = branch.pullRequest.url + '#' + branch.pullRequest.number;
      const links = branchLinks.get(key) ?? [];
      links.push({ repositoryId: repository.id, branchId: branch.id, branch });
      branchLinks.set(key, links);
    }
    for (const pull of repository.github?.pulls ?? []) {
      const id = pullKey(pull);
      const previous = work.get(id);
      const links = branchLinks.get(pull.url + '#' + pull.number) ?? [];
      work.set(id, {
        id,
        pull: mergePullEvidence(pull, previous?.pull),
        links: [...(previous?.links ?? []), ...links],
        projects: [...new Set([...(previous?.projects ?? []), repository.name])],
      });
    }
  }
  return [...work.values()].sort(
    (a, b) => b.pull.updatedAt.localeCompare(a.pull.updatedAt) || a.id.localeCompare(b.id),
  );
}
export function peopleFor(work: PullWork[]): PersonWork[] {
  const people = new Map<string, PersonWork>();
  const ensure = (actor?: GitHubActor) => {
    const id = actor?.id ?? 'unknown-author';
    let person = people.get(id);
    if (!person) {
      person = { id, actor, authored: 0, requested: 0, drafts: 0 };
      people.set(id, person);
    }
    return person;
  };
  for (const { pull } of work) {
    const author = ensure(pull.author);
    author.authored++;
    if (pull.state !== 'open') continue;
    if (pull.draft) author.drafts++;
    for (const actor of new Map(
      pull.requestedReviewers?.map((actor) => [actor.id, actor]),
    ).values())
      ensure(actor).requested++;
  }
  return [...people.values()].sort(
    (a, b) =>
      b.authored + b.requested - (a.authored + a.requested) ||
      (a.actor?.login ?? '').localeCompare(b.actor?.login ?? ''),
  );
}
export function workTools(work: PullWork): CodingTool[] {
  const tools = [
    ...new Set(work.links.flatMap(({ branch }) => branchTools(branch).map(({ tool }) => tool))),
  ];
  return tools.length ? tools : ['unknown'];
}

function pullMatchesScope(item: PullWork, options: PullScope) {
  const { pull } = item;
  const query = options.query.trim().toLocaleLowerCase();
  if (!pullInvolvesPerson(pull, options.person)) return false;
  if (options.project !== 'all' && pull.repository.toLowerCase() !== options.project) return false;
  if (options.tool !== 'all' && !workTools(item).includes(options.tool as CodingTool)) return false;
  if (!query) return true;
  const text = [
    pull.title,
    pull.repository,
    pull.headName,
    '#' + pull.number,
    String(pull.number),
    pull.author?.login,
    ...item.projects,
    ...(pull.requestedReviewers?.map((actor) => actor.login) ?? []),
    ...(pull.requestedTeams?.map((team) => team.name + ' ' + team.slug) ?? []),
    ...item.links.map(({ branch }) => agentSearchText(branch)),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return text.includes(query);
}

function pullMatchesFilter(pull: GitHubPullRequest, filter: PullFilter, now: number) {
  return filter === 'history'
    ? pull.state !== 'open'
    : filter === 'requested'
      ? reviewRequested(pull)
      : filter === 'failed-checks'
        ? hasFailedChecks(pull, now) && !pullSourceStale(pull, now)
        : filter === 'quiet-drafts'
          ? quietDraft(pull, now)
          : pull.state === 'open';
}

export const matchingPullScope = (work: PullWork[], options: PullScope) =>
  work.filter((item) => pullMatchesScope(item, options));

export function pullFilterCounts(work: PullWork[], options: PullScope, now = Date.now()) {
  const counts: Record<PullFilter, number> = {
    open: 0,
    requested: 0,
    'failed-checks': 0,
    'quiet-drafts': 0,
    history: 0,
  };
  for (const item of work) {
    if (!pullMatchesScope(item, options)) continue;
    for (const filter of Object.keys(counts) as PullFilter[])
      if (pullMatchesFilter(item.pull, filter, now)) counts[filter]++;
  }
  return counts;
}

export function matchingPulls(
  work: PullWork[],
  options: PullScope & { filter: PullFilter },
  now = Date.now(),
) {
  const matches = matchingPullScope(work, options).filter((item) =>
    pullMatchesFilter(item.pull, options.filter, now),
  );
  if (options.filter !== 'open') return matches;
  return matches.sort(
    (a, b) =>
      pullAttentionRank(a.pull, now) - pullAttentionRank(b.pull, now) ||
      b.pull.updatedAt.localeCompare(a.pull.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
