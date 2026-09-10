import type { ActivityEvent, Branch, Repository } from './types';

export type ActivityFilter = 'all' | ActivityEvent['kind'];

export interface ActivityItem {
  event: ActivityEvent;
  repositoryName: string;
}

export interface ActivityScope {
  query: string;
  project: string;
}

const timestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export function activityItems(events: ActivityEvent[], repositories: Repository[]): ActivityItem[] {
  const names = new Map(repositories.map((repository) => [repository.id, repository.name]));
  return events
    .map((event) => ({
      event,
      repositoryName: names.get(event.repositoryId) ?? 'Project unavailable',
    }))
    .sort(
      (a, b) =>
        timestamp(b.event.at) - timestamp(a.event.at) || a.event.id.localeCompare(b.event.id),
    );
}

export function matchingActivity(items: ActivityItem[], scope: ActivityScope) {
  const query = scope.query.trim().toLocaleLowerCase();
  return items.filter(({ event, repositoryName }) => {
    if (scope.project !== 'all' && event.repositoryId !== scope.project) return false;
    if (!query) return true;
    return [event.title, event.detail, repositoryName]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function activityCounts(items: ActivityItem[]): Record<ActivityFilter, number> {
  const counts: Record<ActivityFilter, number> = {
    all: items.length,
    commit: 0,
    branch: 0,
    worktree: 0,
    integration: 0,
  };
  for (const { event } of items) counts[event.kind]++;
  return counts;
}

export function filterActivity(items: ActivityItem[], filter: ActivityFilter) {
  return filter === 'all' ? items : items.filter(({ event }) => event.kind === filter);
}

function calendarStart(value: number) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function activityDayLabel(value: string, now = Date.now()) {
  const at = timestamp(value);
  if (!Number.isFinite(at)) return 'Date unavailable';
  const days = Math.round((calendarStart(now) - calendarStart(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
}

export function groupActivity(items: ActivityItem[], now = Date.now()) {
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const label = activityDayLabel(item.event.at, now);
    const previous = groups.at(-1);
    if (previous?.label === label) previous.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

const branchTip = (branch: Branch) => branch.local?.sha ?? branch.remote?.sha;

const worktreeSignature = (branch: Branch) => {
  return JSON.stringify(
    branch.worktrees
      .map(({ path, available }) => ({ path, available }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
};

/** Derive only facts observed between two local Git scans. Repository paths stay out of events. */
export function observedActivity(previous: Repository, current: Repository): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const branch of current.branches) {
    const prior = previous.branches.find(({ id }) => id === branch.id);
    if (!prior) {
      events.push({
        id: `${branch.id}:branch:${current.scannedAt}`,
        repositoryId: current.id,
        branchId: branch.id,
        kind: 'branch',
        title: 'Branch discovered',
        detail: branch.title,
        at: current.scannedAt,
      });
      continue;
    }
    if (branchTip(prior) !== branchTip(branch))
      events.push({
        id: `${branch.id}:commit:${current.scannedAt}`,
        repositoryId: current.id,
        branchId: branch.id,
        kind: 'commit',
        title: 'Branch tip changed',
        detail: branch.title,
        at: current.scannedAt,
      });
    if (worktreeSignature(prior) !== worktreeSignature(branch)) {
      const copies = branch.worktrees.filter(({ available }) => available).length;
      events.push({
        id: `${branch.id}:worktree:${current.scannedAt}`,
        repositoryId: current.id,
        branchId: branch.id,
        kind: 'worktree',
        title: 'Worktree locations changed',
        detail: `${branch.title} · ${copies} ${copies === 1 ? 'available copy' : 'available copies'}`,
        at: current.scannedAt,
      });
    }
    for (const [target, state] of Object.entries(branch.integration))
      if (state === 'integrated' && prior.integration[target] !== 'integrated')
        events.push({
          id: `${branch.id}:integration:${target}:${current.scannedAt}`,
          repositoryId: current.id,
          branchId: branch.id,
          kind: 'integration',
          title: `Integrated into ${target}`,
          detail: branch.title,
          at: current.scannedAt,
        });
  }
  return events;
}
