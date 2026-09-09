import type { Branch, GitRef, IntegrationState, Repository } from '../../src/domain/types';
import { titleFromBranch } from '../../src/domain/branches';
import type { RemoteSnapshot } from './reader';

/** Git remains the source for working files and local ancestry. GitHub adds a
 * separate observed remote tip; a new tip never inherits old ancestry. */
export function enrichRepository(repository: Repository, sources: RemoteSnapshot[]): Repository {
  if (!sources.length) return repository;
  const branches: Branch[] = repository.branches.map((branch) => ({
    ...branch,
    pullRequest: undefined,
  }));
  const unknown = () =>
    Object.fromEntries(
      repository.targets.map((target) => [target.name, 'unknown' as IntegrationState]),
    );
  const stateFor = (sha: string) => {
    for (const branch of repository.branches) {
      if (branch.local?.sha === sha) return branch.integration;
      if (branch.remote?.sha === sha)
        return branch.local ? (branch.remoteIntegration ?? unknown()) : branch.integration;
    }
    return unknown();
  };
  for (const source of sources) {
    const live = new Map(source.branches.map((ref) => [ref.name, ref]));
    for (const branch of branches) {
      if (branch.remote?.remote === source.remoteName && !live.has(branch.remote.name)) {
        branch.remote = {
          ...branch.remote,
          presence: source.branchesComplete && !source.error ? 'missing' : 'unknown',
          checkedAt: source.checkedAt,
        };
      }
    }
    for (const ref of source.branches) {
      const fullName = `refs/remotes/${source.remoteName}/${ref.name}`;
      let branch = branches.find(
        (b) => b.remote?.fullName === fullName || b.local?.upstream === fullName,
      );
      const cached = branch?.remote?.sha === ref.sha ? branch.remote : undefined;
      const remote: GitRef = {
        name: ref.name,
        fullName,
        sha: ref.sha,
        remote: source.remoteName,
        source: 'github',
        presence: source.error ? 'unknown' : 'present',
        checkedAt: source.checkedAt,
        updatedAt: cached?.updatedAt ?? '',
        subject: cached?.subject ?? '',
      };
      if (branch) {
        branch.remote = remote;
        if (branch.local) branch.remoteIntegration = stateFor(ref.sha);
        else {
          branch.integration = stateFor(ref.sha);
          branch.updatedAt = remote.updatedAt;
        }
      } else {
        branch = {
          id: `${repository.id}:${fullName}`,
          repositoryId: repository.id,
          name: ref.name,
          title: titleFromBranch(ref.name),
          remote,
          worktrees: [],
          updatedAt: remote.updatedAt,
          integration: stateFor(ref.sha),
          codexNamed: ref.name.startsWith('codex/'),
          detached: false,
          pullRequest: undefined,
        };
        branches.push(branch);
      }
      // Open PRs can still be relevant when the local branch has advanced.
      // Closed/merged PRs are attached only to an exactly matching commit.
      const related = sources
        .flatMap((s) => s.pulls)
        .filter(
          (pr) =>
            pr.headRepository.toLowerCase() === source.repository.toLowerCase() &&
            pr.headName === ref.name &&
            (pr.state === 'open'
              ? pr.headSha === ref.sha
              : pr.headSha === (branch!.local?.sha ?? ref.sha)),
        )
        .sort(
          (a, b) =>
            Number(b.state === 'open') - Number(a.state === 'open') ||
            b.updatedAt.localeCompare(a.updatedAt),
        );
      branch.pullRequest = related[0];
    }
  }
  return {
    ...repository,
    branches,
    github: {
      checkedAt: sources.map((s) => s.checkedAt).sort()[0],
      partial: sources.some((s) => !s.branchesComplete || !s.pullHistoryComplete),
      error: sources.find((s) => s.error)?.error,
    },
  };
}
