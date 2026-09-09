import type { PullFilter } from '../domain/collaboration';
import { knownTool } from '../domain/agents';
export interface PeoplePosition {
  query: string;
  person: string | null;
  project: string;
  tool: string;
  filter: PullFilter;
  page: number;
  peoplePage: number;
}
export function peoplePosition(value: unknown): PeoplePosition {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.length <= 2048 ? value : fallback;
  const page = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000
      ? Math.floor(value)
      : 0;
  const filters: PullFilter[] = ['open', 'requested', 'failed-checks', 'quiet-drafts', 'history'];
  return {
    query: text(data.query, ''),
    person:
      typeof data.person === 'string' && data.person.length > 0 && data.person.length <= 200
        ? data.person
        : null,
    project: text(data.project, 'all'),
    tool: data.tool === 'all' || data.tool === undefined ? 'all' : knownTool(data.tool),
    filter: filters.includes(data.filter as PullFilter) ? (data.filter as PullFilter) : 'open',
    page: page(data.page),
    peoplePage: page(data.peoplePage),
  };
}
export function updatePeoplePosition(previous: PeoplePosition, patch: Partial<PeoplePosition>) {
  const changed = (keys: (keyof PeoplePosition)[]) =>
    keys.some((key) => patch[key] !== undefined && patch[key] !== previous[key]);
  return peoplePosition({
    ...previous,
    ...patch,
    ...(changed(['query', 'person', 'project', 'tool', 'filter']) ? { page: 0 } : {}),
    ...(changed(['query', 'project', 'tool', 'filter']) ? { peoplePage: 0 } : {}),
  });
}
