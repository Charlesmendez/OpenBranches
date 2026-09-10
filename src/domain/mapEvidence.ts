import type { Branch, IntegrationState, Repository, Target } from './types';
import { sourceStale, pullSourceStale } from './sourceFreshness';
import { githubRepository } from '../github/identity';

export interface MapTargetEvidence {
  target: Target;
  state: IntegrationState;
  stale: boolean;
  label: string;
  detail: string;
  connection: 'history' | 'pull-request' | undefined;
  pullLabel?: string;
}
export type MapSource = 'local' | 'github';
export function mapTargets(repository: Repository, source: MapSource = 'local'): Target[] {
  if (source === 'local') return repository.targets;
  const histories = repository.branches.flatMap((branch) =>
    branch.publishedHistory ? [branch.publishedHistory] : [],
  );
  const remotes = new Set(histories.map((history) => history.remoteName));
  const primary = histories
    .filter((history) => history.remoteName === 'origin' || remotes.size === 1)
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  return (
    primary?.targets.map((target) => ({
      name: target.name,
      sha: target.sha,
      source: 'github',
      remote: primary.remoteName,
      role: repository.targets.find((candidate) => candidate.name === target.name)?.role,
    })) ?? []
  );
}

/** Edges describe inclusion or a PR destination, never an inferred branch origin.
 * Each target is evaluated independently against the displayed branch tip. */
export function mapEvidence(
  repository: Repository,
  branch: Branch,
  now = Date.now(),
  view: MapSource = 'local',
  targets = mapTargets(repository, view),
): MapTargetEvidence[] {
  const tip = view === 'github' ? branch.remote : (branch.local ?? branch.remote);
  return targets.map((target) => {
    const published = branch.publishedHistory;
    const publishedTarget = published?.targets.find(
      (candidate) => candidate.name === target.name && candidate.sha === target.sha,
    );
    const matchingPublished =
      !!tip &&
      !!published &&
      published.remoteName === target.remote &&
      published.branchSha === tip.sha;
    const state = !tip
      ? 'unknown'
      : view === 'github'
        ? matchingPublished
          ? (publishedTarget?.state ?? 'unknown')
          : 'unknown'
        : (branch.integration[target.name] ?? 'unknown');
    const source =
      target.source === 'local'
        ? 'local'
        : target.source === 'cached-remote'
          ? 'cached remote'
          : 'GitHub';
    const stale =
      target.source === 'cached-remote' ||
      (view === 'github' &&
        (!matchingPublished || !!published?.unavailable || !!published?.partial)) ||
      sourceStale(
        {
          observedAt:
            target.source === 'github'
              ? (repository.github?.checkedAt ?? '')
              : repository.scannedAt,
          error:
            repository.error ?? (target.source === 'github' ? repository.github?.error : undefined),
        },
        now,
      );
    const pull = branch.pullRequest;
    const targetRepository = repository.remotes.find((remote) => remote.name === target.remote);
    const targetIdentity = targetRepository
      ? githubRepository(targetRepository.url)?.toLowerCase()
      : undefined;
    // A PR can refer to another tip after local commits, force-pushes, or a retained snapshot.
    const pullMatches =
      target.source === 'github' &&
      !!targetIdentity &&
      pull?.repository?.toLowerCase() === targetIdentity &&
      !stale &&
      pull.state === 'open' &&
      pull.base === target.name &&
      pull.headSha === tip?.sha &&
      !repository.github?.error &&
      !pullSourceStale(
        { ...pull, observedAt: pull.observedAt ?? repository.github?.checkedAt ?? '' },
        now,
      );
    const status = state === 'integrated' ? 'In' : state === 'pending' ? 'Not in' : 'Unknown in';
    const uncommitted =
      view === 'local' && branch.worktrees.some((tree) => tree.available && tree.dirty === true);
    const label =
      state === 'integrated' && uncommitted
        ? `Committed tip in ${target.name}`
        : `${status} ${target.name}`;
    return {
      target,
      state,
      stale,
      label: `${label}${stale ? ' · cached' : ''}`,
      detail: `${tip?.sha.slice(0, 7) ?? 'Unknown tip'} ${state === 'integrated' ? 'is an ancestor of' : state === 'pending' ? 'is not an ancestor of' : 'could not be compared with'} ${source} ${target.name} (${target.sha.slice(0, 7)}).${uncommitted ? ' Uncommitted files are not part of this comparison.' : ''}${state === 'pending' ? ' Squashed, rebased, or cherry-picked changes may still be included.' : ''}${stale ? ' This is saved evidence; refresh before acting.' : ''}`,
      connection: state === 'integrated' ? 'history' : pullMatches ? 'pull-request' : undefined,
      ...(pullMatches ? { pullLabel: `PR #${pull.number} → ${target.name}` } : {}),
    };
  });
}
