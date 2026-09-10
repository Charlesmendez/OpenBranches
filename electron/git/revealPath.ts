import type { Repository } from '../../src/domain/types';

/** Resolve only paths already present in the latest trusted Git scan. Renderer
 * input can select a copy but cannot turn this into an arbitrary filesystem opener. */
export function revealPathFor(
  repository: Repository,
  branchId?: string,
  requestedPath?: string,
): string {
  const branch = branchId
    ? repository.branches.find((candidate) => candidate.id === branchId)
    : undefined;
  if (branchId && !branch) throw new Error('Branch no longer exists. Refresh the repository.');
  if (requestedPath) {
    const worktree = branch?.worktrees.find(
      (candidate) => candidate.available && candidate.path === requestedPath,
    );
    if (!worktree) throw new Error('Worktree is unavailable. Refresh the repository.');
    return worktree.path;
  }
  return branch?.worktrees.find((candidate) => candidate.available)?.path ?? repository.path;
}
