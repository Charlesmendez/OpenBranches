import type { ActivityFilter } from '../domain/activity';

export interface ActivityPosition {
  query: string;
  project: string;
  filter: ActivityFilter;
  page: number;
}

export function activityPosition(value: unknown): ActivityPosition {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const filters: ActivityFilter[] = ['all', 'commit', 'branch', 'worktree', 'integration'];
  return {
    query: typeof data.query === 'string' && data.query.length <= 2048 ? data.query : '',
    project: typeof data.project === 'string' && data.project.length <= 4096 ? data.project : 'all',
    filter: filters.includes(data.filter as ActivityFilter)
      ? (data.filter as ActivityFilter)
      : 'all',
    page:
      typeof data.page === 'number' &&
      Number.isFinite(data.page) &&
      data.page >= 0 &&
      data.page <= 100_000
        ? Math.floor(data.page)
        : 0,
  };
}

export function updateActivityPosition(
  previous: ActivityPosition,
  patch: Partial<ActivityPosition>,
) {
  const scopeChanged = (['query', 'project', 'filter'] as const).some(
    (key) => patch[key] !== undefined && patch[key] !== previous[key],
  );
  return activityPosition({ ...previous, ...patch, ...(scopeChanged ? { page: 0 } : {}) });
}
