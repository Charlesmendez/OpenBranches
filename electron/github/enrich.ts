import type { Branch, GitRef, IntegrationState, Repository } from '../../src/domain/types';
import { titleFromBranch } from '../../src/domain/branches';
import type { RemoteSnapshot } from './reader';
import { historyKey, publishedTargets } from './history';

/** Git remains the source for working files and local ancestry. GitHub adds a
 * separate observed remote tip; a new tip never inherits old ancestry. */
export function enrichRepository(repository: Repository, sources: RemoteSnapshot[]): Repository {
  if (!sources.length) return repository;
  const branches: Branch[] = repository.branches.map((branch) => ({
    ...branch,
    pullRequest: undefined,
    publishedHistory: undefined,
  }));
  const targets = [...repository.targets];
  // A local target always keeps its identity. GitHub supplies a missing target
  // from origin (or the sole configured GitHub source), never a fork at random.
  const primary =
    sources.find((source) => source.remoteName === 'origin') ??
    (sources.length === 1 ? sources[0] : undefined);
  if (primary)
    for (const target of publishedTargets(primary.branches)) {
      if (!targets.some((existing) => existing.name === target.name))
        targets.push({ ...target, source: 'github', remote: primary.remoteName });
    }
  const localStates = new Map<string, Record<string, IntegrationState>>();
  for (const branch of repository.branches) {
    if (branch.local) localStates.set(branch.local.sha, branch.integration);
  }
  for (const branch of repository.branches) {
    if (branch.remote && !localStates.has(branch.remote.sha))
      localStates.set(
        branch.remote.sha,
        branch.local ? (branch.remoteIntegration ?? {}) : branch.integration,
      );
  }
  for (const source of sources) {
    const checks = new Map(
      source.history?.checks.map((check) => [historyKey(check.branchSha, check.targetSha), check]),
    );
    const stateFor = (sha: string) =>
      Object.fromEntries(
        targets.map((target) => {
          const local = localStates.get(sha)?.[target.name];
          return [
            target.name,
            sha === target.sha
              ? 'integrated'
              : local && local !== 'unknown'
                ? local
                : (checks.get(historyKey(sha, target.sha))?.state ?? 'unknown'),
          ];
        }),
      ) as Record<string, IntegrationState>;
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
        if (branch.local) {
          branch.integration = stateFor(branch.local.sha);
          branch.remoteIntegration = stateFor(ref.sha);
        } else {
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
      branch.publishedHistory = {
        repository: source.repository,
        remoteName: source.remoteName,
        branchSha: ref.sha,
        checkedAt: source.checkedAt,
        unavailable: !!source.error,
        partial: !source.branchesComplete,
        targets: publishedTargets(source.branches).map((target) => {
          const check = checks.get(historyKey(ref.sha, target.sha));
          return {
            ...target,
            state: check?.state ?? 'unknown',
            checkedAt: check?.checkedAt,
            source: check?.source,
          };
        }),
        error: source.history?.error,
      };
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
    targets,
    branches,
    github: {
      checkedAt: sources.map((s) => s.checkedAt).sort()[0],
      partial: sources.some((s) => !s.branchesComplete || !s.pullHistoryComplete),
      error: sources.find((s) => s.error)?.error,
      history: {
        checked: sources.reduce(
          (count, source) =>
            count +
            (source.history?.checks.filter((check) => check.state !== 'unknown').length ?? 0),
          0,
        ),
        total: sources.reduce(
          (count, source) =>
            count +
            new Set(source.branches.map((branch) => branch.sha)).size *
              new Set(publishedTargets(source.branches).map((target) => target.sha)).size,
          0,
        ),
        error: sources.find((source) => source.history?.error)?.history?.error,
      },
    },
  };
}
