import { agentSearchText } from './agents';
import { featureBranches } from './branches';
import type { Branch, Repository } from './types';
import { workSignal, type WorkSignal } from './workSpotlight';

export interface BranchSearchResult {
  repository: Repository;
  branch: Branch;
  /** Fresh, verified runtime evidence only. */
  activity?: WorkSignal;
}

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();

const activityFor = (branch: Branch, repository: Repository, now: number) => {
  const signal = workSignal(branch, repository.path, now);
  return signal?.kind === 'live' || signal?.kind === 'waiting' ? signal : undefined;
};

const fieldMatch = (value: string, term: string) => {
  if (value === term) return 200;
  if (value.startsWith(term)) return 100;
  return value.split(/[^\p{L}\p{N}]+/u).some((token) => token.startsWith(term)) ? 1 : 0;
};

const relevance = (
  branch: Branch,
  repository: Repository,
  activity: WorkSignal | undefined,
  terms: string[],
) => {
  const fields = [
    { value: normalize(branch.title), weight: 500 },
    { value: normalize(branch.name), weight: 480 },
    { value: normalize(repository.name), weight: 300 },
    { value: normalize(agentSearchText(branch)), weight: 260 },
    { value: normalize(`${activity?.label ?? ''} ${activity?.detail ?? ''}`), weight: 240 },
  ];
  if (!terms.every((term) => fields.some(({ value }) => fieldMatch(value, term)))) return -1;
  return terms.reduce(
    (score, term) =>
      score +
      Math.max(
        ...fields.map(({ value, weight }) => {
          const match = fieldMatch(value, term);
          return match ? weight + match : 0;
        }),
      ),
    0,
  );
};

/** Search every feature branch while keeping text relevance authoritative.
 * Fresh live work breaks comparable matches and leads the empty search. */
export function branchSearchResults(
  repositories: Repository[],
  query: string,
  now = Date.now(),
): BranchSearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return repositories
    .flatMap((repository) =>
      featureBranches(repository).flatMap((branch) => {
        const activity = activityFor(branch, repository, now);
        const score = terms.length ? relevance(branch, repository, activity, terms) : 0;
        return score < 0 ? [] : [{ repository, branch, activity, score }];
      }),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.activity?.priority ?? 0) - (left.activity?.priority ?? 0) ||
        (Date.parse(right.branch.updatedAt) || 0) - (Date.parse(left.branch.updatedAt) || 0) ||
        left.repository.name.localeCompare(right.repository.name) ||
        left.branch.name.localeCompare(right.branch.name),
    )
    .map(({ repository, branch, activity }) => ({ repository, branch, activity }));
}
