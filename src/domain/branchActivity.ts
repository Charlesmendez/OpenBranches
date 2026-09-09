import type { Branch, TaskLink } from './types';
import { knownTool, toolNames } from './agents';

const MINUTE = 60_000;
export const LIVE_ACTIVITY_TTL = 90 * 1000;
export const IDLE_WORK_DAYS = 7;
const age = (value: string | undefined, now: number) => {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time <= now + MINUTE ? Math.max(0, now - time) : Infinity;
};
export function liveTasks(branch: Branch, now = Date.now()): TaskLink[] {
  return (branch.tasks ?? []).filter(
    (task) =>
      !task.archived &&
      task.association === 'verified' &&
      task.status === 'active' &&
      age(task.checkedAt, now) <= LIVE_ACTIVITY_TTL,
  );
}
export function waitingTasks(branch: Branch, now = Date.now()): TaskLink[] {
  return (branch.tasks ?? []).filter(
    (task) =>
      !task.archived &&
      task.association === 'verified' &&
      task.waiting &&
      age(task.checkedAt, now) <= LIVE_ACTIVITY_TTL,
  );
}

/** A saved task, PR author, or dirty worktree alone never proves live presence. */
export function branchActivity(branch: Branch, now = Date.now()) {
  const live = liveTasks(branch, now);
  if (live.length)
    return {
      kind: 'live' as const,
      label: `${[...new Set(live.map((task) => toolNames[knownTool(task.tool)]))].join(' + ')} working`,
      detail: live.map((task) => task.title).join(' · '),
    };
  const waiting = waitingTasks(branch, now);
  if (waiting.length)
    return {
      kind: 'waiting' as const,
      label: 'Codex waiting for input',
      detail: waiting.map((task) => task.title).join(' · '),
    };
  const recent = (branch.tasks ?? []).filter(
    (task) =>
      !task.archived && task.association === 'verified' && age(task.updatedAt, now) < 5 * MINUTE,
  );
  if (recent.length)
    return {
      kind: 'recent' as const,
      label: `${[...new Set(recent.map((task) => toolNames[knownTool(task.tool)]))].join(' + ')} task updated`,
      detail: 'Recent task activity. Live execution has not been confirmed.',
    };
  if (branch.worktrees.some((tree) => tree.dirty))
    return {
      kind: 'changes' as const,
      label: 'Uncommitted work',
      detail: 'Changes on this Mac. The editor or person currently working is not known.',
    };
  const days = Math.floor(age(branch.updatedAt, now) / (24 * 60 * MINUTE));
  const actor = (branch.local ?? branch.remote)?.author;
  return {
    kind: 'idle' as const,
    label: Number.isFinite(days)
      ? days === 0
        ? 'Committed today'
        : `Last commit ${days}d ago`
      : 'Activity unknown',
    detail: actor
      ? `Last commit by ${actor}. This does not establish who is working now.`
      : 'Live activity is not available for this branch.',
  };
}

export function idleWork(branch: Branch, now = Date.now()) {
  const lastActivity = Math.max(
    Date.parse(branch.updatedAt) || 0,
    ...(branch.tasks ?? [])
      .filter((task) => !task.archived && task.association === 'verified')
      .map((task) => Date.parse(task.updatedAt ?? '') || 0),
  );
  const days = Math.floor((now - lastActivity) / 86_400_000);
  const pending = Object.values(branch.integration).some((state) => state === 'pending');
  const active =
    liveTasks(branch, now).length > 0 ||
    waitingTasks(branch, now).length > 0 ||
    branch.pullRequest?.state === 'open';
  const unchecked = branch.worktrees.some((tree) => !tree.available || tree.dirty !== false);
  return pending && lastActivity > 0 && days >= IDLE_WORK_DAYS && !active && !unchecked
    ? {
        days,
        unassigned: !branch.tasks?.some(
          (task) => !task.archived && task.association === 'verified',
        ),
      }
    : undefined;
}
