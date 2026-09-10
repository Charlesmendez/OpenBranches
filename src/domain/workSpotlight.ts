import { knownTool, toolNames } from './agents';
import { liveTasks, waitingTasks } from './branchActivity';
import type { Branch, CodingTool, TaskLink } from './types';

const RECENT_TASK_TTL = 5 * 60_000;
const RECENT_COMMIT_TTL = 15 * 60_000;

export type WorkSignalKind = 'live' | 'waiting' | 'changes' | 'recent' | 'checkout';

export interface WorkSignal {
  kind: WorkSignalKind;
  label: string;
  detail: string;
  priority: number;
  tools: CodingTool[];
}

export interface BranchSpotlight {
  branch: Branch;
  signal: WorkSignal;
}

const pathKey = (value: string) => value.replace(/\/+$/, '');
const isFresh = (value: string | undefined, now: number, ttl: number) => {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time <= now + 60_000 && now - time <= ttl;
};
const taskTools = (tasks: TaskLink[]) => [...new Set(tasks.map((task) => knownTool(task.tool)))];
const taskLabel = (tasks: TaskLink[]) =>
  taskTools(tasks)
    .map((tool) => toolNames[tool])
    .join(' + ');

/** Ranks evidence that helps someone find work without turning a checkout,
 * dirty tree, commit author, or saved task into a claim of live presence. */
export function workSignal(
  branch: Branch,
  repositoryPath: string,
  now = Date.now(),
): WorkSignal | undefined {
  const live = liveTasks(branch, now);
  if (live.length)
    return {
      kind: 'live',
      label: `${taskLabel(live)} working now`,
      detail: live.map((task) => task.title).join(' · '),
      priority: 500,
      tools: taskTools(live),
    };

  const waiting = waitingTasks(branch, now);
  if (waiting.length)
    return {
      kind: 'waiting',
      label: `${taskLabel(waiting)} waiting for input`,
      detail: waiting.map((task) => task.title).join(' · '),
      priority: 450,
      tools: taskTools(waiting),
    };

  const primary = branch.worktrees.find(
    (tree) => tree.available && pathKey(tree.path) === pathKey(repositoryPath),
  );
  const changed = primary?.dirty
    ? primary
    : branch.worktrees.find((tree) => tree.available && tree.dirty);
  if (changed) {
    const count = changed.changedFiles;
    return {
      kind: 'changes',
      label: primary === changed ? 'Local changes here' : 'Uncommitted worktree',
      detail:
        (count === null || count <= 0
          ? 'Uncommitted changes were found.'
          : `${count} uncommitted ${count === 1 ? 'file' : 'files'} found.`) +
        ' The active person or agent is not confirmed.',
      priority: primary === changed ? 400 : 350,
      tools: [],
    };
  }

  const recentTasks = (branch.tasks ?? []).filter(
    (task) =>
      !task.archived &&
      task.association === 'verified' &&
      isFresh(task.updatedAt, now, RECENT_TASK_TTL),
  );
  if (recentTasks.length)
    return {
      kind: 'recent',
      label: `${taskLabel(recentTasks)} updated recently`,
      detail: 'Recent task metadata was observed. Live execution is not confirmed.',
      priority: 300,
      tools: taskTools(recentTasks),
    };

  if (primary && isFresh(branch.updatedAt, now, RECENT_COMMIT_TTL))
    return {
      kind: 'recent',
      label: 'Current checkout just changed',
      detail: 'A recent commit was observed in this checkout. Live execution is not confirmed.',
      priority: 250,
      tools: [],
    };

  if (primary)
    return {
      kind: 'checkout',
      label: 'Current checkout',
      detail: 'This branch is checked out at the project root. Live execution is not confirmed.',
      priority: 100,
      tools: [],
    };
}

export function workSpotlights(
  branches: Branch[],
  repositoryPath: string,
  now = Date.now(),
): BranchSpotlight[] {
  return branches
    .flatMap((branch) => {
      const signal = workSignal(branch, repositoryPath, now);
      return signal ? [{ branch, signal }] : [];
    })
    .sort(
      (a, b) =>
        b.signal.priority - a.signal.priority ||
        (Date.parse(b.branch.updatedAt) || 0) - (Date.parse(a.branch.updatedAt) || 0) ||
        a.branch.name.localeCompare(b.branch.name),
    );
}

export function prioritizeWork(
  branches: Branch[],
  repositoryPath: string,
  now = Date.now(),
): Branch[] {
  const ranks = new Map(
    workSpotlights(branches, repositoryPath, now).map(({ branch, signal }) => [
      branch.id,
      signal.priority,
    ]),
  );
  return branches
    .map((branch, index) => ({ branch, index }))
    .sort(
      (a, b) => (ranks.get(b.branch.id) ?? 0) - (ranks.get(a.branch.id) ?? 0) || a.index - b.index,
    )
    .map(({ branch }) => branch);
}
