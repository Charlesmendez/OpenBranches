import type { GitHubActor, GitHubPullRequest, Repository } from '../domain/types';
import { demoSignals } from './demoSignals';

// Entirely fictional. These records exercise a shared GitHub view; no membership
// or local sharing is inferred from the demo's author/reviewer records.
const names = [
  'maya-chen',
  'alex-rivera',
  'sam-okafor',
  'nina-patel',
  'leo-martin',
  'zoe-park',
  'ari-cohen',
  'devon-reed',
  'riley-james',
  'jules-kim',
  'casey-bell',
  'build-helper',
];
const person = (index: number): GitHubActor => ({
  id: String(90000 + (index % names.length)),
  login: names[index % names.length],
  kind: index % names.length === 11 ? 'bot' : 'user',
});
export function withDemoPeople(repository: Repository, now: number): Repository {
  const slug = 'example/' + repository.name;
  const seed = repository.id === 'atlas' ? 0 : repository.id === 'studio' ? 4 : 8;
  const pulls: GitHubPullRequest[] = [];
  const branches = repository.branches.map((branch, index) => {
    if (!branch.pullRequest) return branch;
    const pull: GitHubPullRequest = {
      ...branch.pullRequest,
      repository: slug,
      url: `https://github.com/${slug}/pull/${branch.pullRequest.number}`,
      headName: branch.name,
      headRepository: slug,
      observedAt: new Date(now - 60_000).toISOString(),
      author: person(seed + index),
      requestedReviewers: index % 3 === 1 ? [] : [person(seed + index + 2)],
      requestedTeams: index === 1 ? [{ id: '900', name: 'Platform', slug: 'platform' }] : [],
      draft: index === 3,
      updatedAt:
        index === 3 ? new Date(now - 18 * 86_400_000).toISOString() : branch.pullRequest.updatedAt,
      signals: demoSignals(branch.pullRequest.headSha, index, person(seed + index + 2), now),
    };
    pulls.push(pull);
    return { ...branch, pullRequest: pull };
  });
  const titles = [
    'Retry webhook delivery',
    'Restore the billing audit trail',
    'Keep search fast at scale',
    'Preview changes before publishing',
    'Unify workspace invitations',
    'Review access requests',
    'Simplify the release workflow',
    'Archive completed experiments',
    'Improve keyboard navigation',
    'Refresh dependency locks',
  ];
  for (let index = 0; index < titles.length; index++) {
    const number = 510 + index;
    pulls.push({
      number,
      title: titles[index],
      repository: slug,
      url: `https://github.com/${slug}/pull/${number}`,
      state: index >= 7 ? (index === 8 ? 'closed' : 'merged') : 'open',
      draft: index === 1 || index === 4,
      base: repository.targets[0]?.name ?? 'main',
      headName: 'feat/' + titles[index].toLowerCase().replaceAll(' ', '-'),
      headSha: (index + 1).toString(16).padStart(40, '0'),
      headRepository: index === 9 ? null : 'example-contributor/' + repository.name,
      updatedAt: new Date(now - (index === 1 ? 24 : index + 1) * 86_400_000).toISOString(),
      observedAt: new Date(now - 60_000).toISOString(),
      author: person(seed + index),
      requestedReviewers: index < 7 && index % 2 === 0 ? [person(seed + index + 1)] : [],
      requestedTeams: [],
      signals: demoSignals(
        (index + 1).toString(16).padStart(40, '0'),
        index,
        person(seed + index + 1),
        now,
      ),
    });
  }
  return {
    ...repository,
    branches,
    github: {
      ...repository.github,
      checkedAt: new Date(now - 60_000).toISOString(),
      partial: false,
      openPullsComplete: true,
      pulls,
    },
  };
}
