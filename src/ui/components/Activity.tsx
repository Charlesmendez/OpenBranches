import { useEffect, useMemo } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  PanelsTopLeft,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityEvent, Repository } from '../../domain/types';
import {
  activityCounts,
  activityItems,
  filterActivity,
  matchingActivity,
  type ActivityFilter,
} from '../../domain/activity';
import { useClock } from '../hooks/useClock';
import { usePageWindow } from '../hooks/usePageWindow';
import { useActivityPosition } from '../hooks/useActivityPosition';
import type { NavigationMemory, WorkspaceMode } from '../navigationMemory';
import { ActivityList } from './ActivityList';
import { CompactPager } from './CompactPager';

const PAGE_SIZE = 20;
const filters: { key: ActivityFilter; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'All changes', icon: History },
  { key: 'commit', label: 'Commits', icon: GitCommitHorizontal },
  { key: 'branch', label: 'Branches', icon: GitBranch },
  { key: 'worktree', label: 'Worktrees', icon: PanelsTopLeft },
  { key: 'integration', label: 'Integrations', icon: GitMerge },
];

export function Activity({
  events,
  repositories,
  demo,
  navigation,
  mode,
  onSelect,
}: {
  events: ActivityEvent[];
  repositories: Repository[];
  demo: boolean;
  navigation: NavigationMemory;
  mode: WorkspaceMode;
  onSelect: (repositoryId: string, branchId?: string) => void;
}) {
  const now = useClock();
  const { position, update } = useActivityPosition(navigation, mode);
  const { query, project, filter, page } = position;
  const setQuery = (query: string) => update({ query });
  const setProject = (project: string) => update({ project });
  const setFilter = (filter: ActivityFilter) => update({ filter });
  const setPage = (page: number) => update({ page });
  const items = useMemo(() => activityItems(events, repositories), [events, repositories]);
  const scoped = useMemo(
    () => matchingActivity(items, { query, project }),
    [items, query, project],
  );
  const counts = useMemo(() => activityCounts(scoped), [scoped]);
  const matches = useMemo(() => filterActivity(scoped, filter), [scoped, filter]);
  const pageKey = [
    query.trim().toLocaleLowerCase(),
    project,
    filter,
    ...matches.map(({ event }) => `${event.id}:${event.at}`),
  ].join('|');
  const current = usePageWindow(matches, PAGE_SIZE, pageKey, { page, onPage: setPage });
  const projects = repositories
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  useEffect(() => {
    if (project !== 'all' && !repositories.some(({ id }) => id === project)) setProject('all');
  }, [project, repositories]);
  const filtered = !!query || project !== 'all' || filter !== 'all';
  const reset = () => {
    setQuery('');
    setProject('all');
    setFilter('all');
  };
  return (
    <section className="activity-workspace" aria-label="Workspace activity">
      <div className="activity-scope">
        <span>{demo ? 'Fictional local history' : 'Local Git history'}</span>
        <span>Newest verified changes first</span>
      </div>
      <div className="activity-toolbar">
        <label className="activity-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a branch, project, or change…"
            aria-label="Search activity"
          />
          {query && (
            <button aria-label="Clear activity search" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter activity by project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="activity-filters" aria-label="Activity types">
        {filters.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`${item.key} ${filter === item.key ? 'selected' : ''}`}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              <Icon size={15} />
              <span>{item.label}</span>
              <strong>{counts[item.key]}</strong>
            </button>
          );
        })}
      </div>
      <div className="activity-heading">
        <div>
          <h2>
            {filter === 'all' ? 'Timeline' : filters.find(({ key }) => key === filter)!.label}
          </h2>
          <p aria-live="polite">
            {matches.length} {matches.length === 1 ? 'change' : 'changes'} in this view
          </p>
        </div>
        {current.pageCount > 1 && (
          <CompactPager
            page={current.page}
            pageSize={PAGE_SIZE}
            count={matches.length}
            label="Activity pages"
            onPage={current.setPage}
          />
        )}
      </div>
      {matches.length ? (
        <ActivityList items={current.items} now={now} grouped onSelect={onSelect} />
      ) : (
        <div className="activity-empty">
          <History size={25} />
          <h2>{items.length ? 'No changes match this view.' : 'Your timeline starts here.'}</h2>
          <p>
            {items.length
              ? 'Try another activity type, project, or search.'
              : 'After the first scan, new branch and commit changes will appear here.'}
          </p>
          {items.length && filtered ? (
            <button className="secondary-button" onClick={reset}>
              Show all activity
            </button>
          ) : null}
        </div>
      )}
      <p className="activity-note">
        This timeline is stored on this Mac and records changes observed after a project’s first
        scan.
      </p>
    </section>
  );
}
