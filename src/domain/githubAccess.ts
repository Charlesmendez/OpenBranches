import { githubRepository } from '../github/identity';
import type { GitHubAppInstallation, Repository } from './types';

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

export interface GitHubOwnerAccess {
  owner: string;
  projectCount: number;
  unavailableCount: number;
  accountType?: GitHubAppInstallation['accountType'];
  repositorySelection?: GitHubAppInstallation['repositorySelection'];
  state: 'checking' | 'connected' | 'selected' | 'not-installed';
}

/** Groups monitored GitHub repositories by owner and joins them to the
 * signed-in user's installations of OpenBranches Desktop. */
export function githubOwnerAccess(
  repositories: Repository[],
  installations: GitHubAppInstallation[] | undefined,
  installationsPartial = false,
): GitHubOwnerAccess[] {
  const owners = new Map<
    string,
    { owner: string; projects: Set<string>; unavailable: Set<string> }
  >();
  for (const repository of repositories) {
    const repositoryOwners = new Map<string, string>();
    for (const remote of repository.remotes) {
      const slug = githubRepository(remote.url);
      if (!slug) continue;
      const owner = slug.split('/')[0];
      repositoryOwners.set(owner.toLowerCase(), owner);
    }
    for (const [key, owner] of repositoryOwners) {
      const current = owners.get(key) ?? {
        owner,
        projects: new Set<string>(),
        unavailable: new Set<string>(),
      };
      current.projects.add(repository.id);
      if (needsGitHubRepositoryAccess(repository)) current.unavailable.add(repository.id);
      owners.set(key, current);
    }
  }
  const installed = new Map(
    installations?.map((installation) => [installation.account.toLowerCase(), installation]),
  );
  return [...owners.entries()]
    .map(([key, owner]) => {
      const installation = installed.get(key);
      const state =
        installations === undefined
          ? 'checking'
          : !installation && installationsPartial
            ? 'checking'
            : !installation
              ? 'not-installed'
              : installation.repositorySelection === 'all'
                ? 'connected'
                : 'selected';
      return {
        owner: owner.owner,
        projectCount: owner.projects.size,
        unavailableCount: owner.unavailable.size,
        ...(installation
          ? {
              accountType: installation.accountType,
              repositorySelection: installation.repositorySelection,
            }
          : {}),
        state,
      } satisfies GitHubOwnerAccess;
    })
    .sort(
      (left, right) =>
        Number(left.state === 'connected') - Number(right.state === 'connected') ||
        left.owner.localeCompare(right.owner),
    );
}
