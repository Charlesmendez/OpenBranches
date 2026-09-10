import type { Repository } from '../domain/types';
import { knownTool, taskKey } from '../domain/agents';
import { sharedSnapshotSchema, type SharedSnapshot, type ShareConsent } from './protocol';

const validSha = (value?: string) =>
  value && /^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(value) ? value : null;
const validTime = (value?: string) =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
/** Used by the Mac preview and publisher. The opaque-key function must use a
 * per-device secret (HMAC), never a raw local path or source session identifier. */
export function prepareSharedSnapshot(
  repository: Repository,
  consent: ShareConsent,
  opaqueKey: (value: string) => string,
): SharedSnapshot {
  const observedAt = validTime(repository.scannedAt);
  if (!observedAt) throw new Error('Refresh this project before preparing its sharing preview.');
  const candidates = repository.branches
    .filter((branch) => !!branch.local || branch.worktrees.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const snapshot: SharedSnapshot = {
    version: 1,
    observedAt,
    branches: [],
    omittedBranches: candidates.length,
    sourceError: !!repository.error,
  };
  let bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length + 64;
  for (const branch of candidates) {
    if (snapshot.branches.length >= 1000) break;
    const tasks = [...new Map((branch.tasks ?? []).map((task) => [taskKey(task), task])).values()];
    const available = branch.worktrees.filter((worktree) => worktree.available);
    const unknownDirty = branch.worktrees.some(
      (worktree) => !worktree.available || worktree.dirty === null,
    );
    const unknownFiles = branch.worktrees.some(
      (worktree) => !worktree.available || worktree.changedFiles === null,
    );
    const item: SharedSnapshot['branches'][number] = {
      key: opaqueKey('branch:' + branch.id),
      name: branch.detached ? 'Detached HEAD' : branch.name.slice(0, 512),
      detached: branch.detached,
      localSha: validSha(
        branch.local?.sha ?? (branch.detached ? branch.worktrees[0]?.head : undefined),
      ),
      ...(validTime(branch.updatedAt) ? { updatedAt: validTime(branch.updatedAt) } : {}),
      ...(branch.remote && validSha(branch.remote.sha)
        ? {
            remote: {
              name: branch.remote.name.slice(0, 512),
              sha: branch.remote.sha,
              presence: branch.remote.presence ?? 'unknown',
            },
          }
        : {}),
      worktrees: {
        total: branch.worktrees.length,
        available: available.length,
        dirty: unknownDirty ? null : available.filter((worktree) => worktree.dirty).length,
        changedFiles: unknownFiles
          ? null
          : available.reduce((sum, worktree) => sum + (worktree.changedFiles ?? 0), 0),
      },
      integration: repository.targets
        .filter((target) => validSha(target.sha))
        .slice(0, 8)
        .map((target) => ({
          name: target.name.slice(0, 512),
          sha: target.sha,
          state: repository.error ? 'unknown' : (branch.integration[target.name] ?? 'unknown'),
        })),
      tasks: tasks.slice(0, 10).map((task) => ({
        key: opaqueKey('task:' + taskKey(task)),
        tool: knownTool(task.tool),
        association: task.association,
        status: task.status,
        ...(task.activitySource ? { activitySource: task.activitySource } : {}),
        ...(task.waiting ? { waiting: true } : {}),
        ...(task.model
          ? {
              model: {
                id: task.model.id.slice(0, 512),
                ...(task.model.provider ? { provider: task.model.provider } : {}),
              },
            }
          : {}),
        ...(consent.taskTitles ? { title: task.title.slice(0, 512) } : {}),
        ...(consent.taskSummaries && task.summary ? { summary: task.summary.slice(0, 1024) } : {}),
        ...(validTime(task.checkedAt) ? { checkedAt: validTime(task.checkedAt) } : {}),
      })),
      omittedTasks: Math.max(0, tasks.length - 10),
    };
    const size = new TextEncoder().encode(JSON.stringify(item)).length + 1;
    if (bytes + size > 750_000) break;
    bytes += size;
    snapshot.branches.push(item);
  }
  snapshot.omittedBranches = candidates.length - snapshot.branches.length;
  return sharedSnapshotSchema.parse(snapshot);
}
