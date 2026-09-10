import { isGrokModel, toolNames } from '../domain/agents';
import type { SharedSnapshot } from './protocol';
import { sharedWorkStale } from './protocol';
import type { SharedWork, TeamPage } from './responses';

export const SHARED_LIVE_ACTIVITY_TTL = 90_000;
type SharedBranch = SharedSnapshot['branches'][number];
type SharedTask = SharedBranch['tasks'][number];

export interface SharedTaskActivity {
  kind: 'live' | 'waiting';
  label: string;
  tasks: SharedTask[];
}

export interface SharedBranchRow {
  work: SharedWork;
  branch: SharedBranch;
  person: string;
  project: string;
  key: string;
  stale: boolean;
  rank: number;
  activity?: SharedTaskActivity;
}

/** A fresh device report may carry a verified local runtime observation. Saved
 * task links, dirty worktrees, and recent commits never become live presence. */
export function sharedTaskActivity(
  work: Pick<SharedWork, 'receivedAt' | 'deviceExpiresAt' | 'snapshot'>,
  branch: SharedBranch,
  now = Date.now(),
): SharedTaskActivity | undefined {
  if (sharedWorkStale(work, now)) return;
  const runtime = branch.tasks.filter(
      (task) =>
        task.association === 'verified' &&
        task.activitySource !== undefined &&
        fresh(task.checkedAt, now),
    ),
    waiting = runtime.filter((task) => task.waiting),
    live = runtime.filter((task) => task.status === 'active' && !task.waiting);
  if (waiting.length) return activity('waiting', waiting);
  if (live.length) return activity('live', live);
}

/** Builds one consistent branch row model for the live summary, groups, and
 * inspector. Names come from the caller's already permission-scoped page. */
export function sharedBranchRows(data: TeamPage, now = Date.now()): SharedBranchRow[] {
  const people = new Map(data.people.map((person) => [person.id, person.login])),
    projects = new Map(data.projects.map((project) => [project.id, project.name]));
  return data.work.flatMap((work) =>
    work.snapshot.branches.map((branch) => {
      const stale = sharedWorkStale(work, now),
        activity = sharedTaskActivity(work, branch, now);
      return {
        work,
        branch,
        person: people.get(work.memberId) ?? 'Member outside this page',
        project: projects.get(work.projectId) ?? 'Project outside this page',
        key: work.deviceId + ':' + work.projectId + ':' + branch.key,
        stale,
        activity,
        rank:
          activity?.kind === 'live'
            ? 0
            : activity?.kind === 'waiting'
              ? 1
              : !stale && branch.worktrees.dirty
                ? 2
                : stale
                  ? 4
                  : 3,
      } satisfies SharedBranchRow;
    }),
  );
}

function activity(kind: SharedTaskActivity['kind'], tasks: SharedTask[]): SharedTaskActivity {
  const names = [
    ...new Set(
      tasks.map((task) => toolNames[task.tool] + (isGrokModel(task.model) ? ' · Grok' : '')),
    ),
  ].join(' + ');
  return {
    kind,
    tasks,
    label: `${names} ${kind === 'live' ? 'working' : 'waiting for input'}`,
  };
}

function fresh(value: string | undefined, now: number) {
  const checked = Date.parse(value ?? '');
  return (
    Number.isFinite(checked) && checked <= now + 60_000 && now - checked <= SHARED_LIVE_ACTIVITY_TTL
  );
}
