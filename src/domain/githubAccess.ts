import type { Repository } from './types';

const githubRemote = /github\.com[/:]/i;

export const hasGitHubRemote = (repository: Repository) =>
  repository.remotes.some((remote) => githubRemote.test(remote.url));

export const needsGitHubRepositoryAccess = (repository: Repository) =>
  Boolean(repository.github?.error?.toLowerCase().includes('repository access'));

export function githubRepositoryAccess(repositories: Repository[]) {
  const projects = repositories.filter(hasGitHubRemote);
  const observed = projects.filter((repository) => repository.github);
  const unavailable = projects.filter(needsGitHubRepositoryAccess);
  return {
    projectCount: projects.length,
    observedCount: observed.length,
    unavailableCount: unavailable.length,
    unavailableNames: unavailable.map((repository) => repository.name),
  };
}
