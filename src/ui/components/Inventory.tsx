import { useMemo, useRef, useState, useEffect } from 'react';
import { Search, X, ArrowUpDown, GitBranch } from 'lucide-react';
import type { Branch, Lifecycle, Repository } from '../../domain/types';
import { lifecycleOf, relativeTime } from '../../domain/branches';
import { EmptyState, IntegrationBadge, Locations } from './Primitives';

const ROW_HEIGHT = 76;
export function Inventory({
  repository,
  branches,
  selectedId,
  onSelect,
  initialQuery = '',
}: {
  repository: Repository;
  branches: Branch[];
  selectedId: string | null;
  onSelect: (branch: Branch) => void;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [location, setLocation] = useState('all');
  const [lifecycle, setLifecycle] = useState('all');
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(550);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return branches
      .filter(
        (branch) =>
          (!needle ||
            [branch.name, branch.title, branch.task?.title].some((v) =>
              v?.toLowerCase().includes(needle),
            )) &&
          (location === 'all' ||
            (location === 'local' && (branch.local || branch.detached)) ||
            (location === 'remote' && branch.remote)) &&
          (lifecycle === 'all' || lifecycleOf(branch) === (lifecycle as Lifecycle)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [branches, query, location, lifecycle]);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    setScrollTop(0);
  }, [query, location, lifecycle]);
  useEffect(() => {
    const index = filtered.findIndex((branch) => branch.id === selectedId);
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: Math.max(0, top - (element.clientHeight - ROW_HEIGHT) / 2) });
    }
  }, [selectedId, filtered]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3);
  const end = Math.min(filtered.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 3);
  const columns = `minmax(220px, 1.65fr) 115px ${repository.targets
    .slice(0, 2)
    .map(() => '140px')
    .join(' ')} 90px`;
  return (
    <div className="inventory">
      <div className="inventory-search">
        <Search size={18} />
        <input
          aria-label="Search branches"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any branch or task…"
        />
        {query && (
          <button aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
        <span>All {branches.length}</span>
      </div>
      <div className="inventory-filters">
        <div>
          <select
            aria-label="Filter location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="all">All locations</option>
            <option value="local">On this Mac</option>
            <option value="remote">With remote reference</option>
          </select>
          <select
            aria-label="Filter lifecycle"
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
          >
            <option value="all">Any activity</option>
            <option value="active">Active work</option>
            <option value="integrated">Integrated</option>
            <option value="quiet">Quiet</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>
        <span>
          <ArrowUpDown size={12} />
          Recently updated
        </span>
      </div>
      <div
        className="inventory-table"
        role="table"
        aria-label="Branch inventory"
        aria-rowcount={filtered.length + 1}
      >
        <div className="inventory-header" role="row" style={{ gridTemplateColumns: columns }}>
          <span role="columnheader">Task / branch</span>
          <span role="columnheader">Location</span>
          {repository.targets.slice(0, 2).map((target) => (
            <span
              role="columnheader"
              key={target.name}
              className={
                target.name === 'master' || target.name === 'main' ? 'amber-text' : 'teal-text'
              }
            >
              <GitBranch size={13} />
              {target.name}
            </span>
          ))}
          <span role="columnheader">Updated</span>
        </div>
        <div
          className="inventory-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {!filtered.length ? (
            <EmptyState
              icon={Search}
              title="No matching branches"
              description="Try a different search or broaden the filters."
            />
          ) : (
            <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
              {filtered.slice(start, end).map((branch, index) => (
                <button
                  key={branch.id}
                  className={`inventory-row ${branch.id === selectedId ? 'selected' : ''}`}
                  role="row"
                  aria-rowindex={start + index + 2}
                  style={{
                    gridTemplateColumns: columns,
                    position: 'absolute',
                    top: (start + index) * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                  }}
                  onClick={() => onSelect(branch)}
                >
                  <span role="cell" className="table-title">
                    <i className={`branch-dot ${lifecycleOf(branch)}`} />
                    <span>
                      <strong>{branch.title}</strong>
                      <code>{branch.name}</code>
                    </span>
                  </span>
                  <span role="cell">
                    <Locations branch={branch} compact />
                  </span>
                  {repository.targets.slice(0, 2).map((target) => (
                    <span role="cell" key={target.name}>
                      <IntegrationBadge state={branch.integration[target.name]} />
                    </span>
                  ))}
                  <span role="cell" className="table-time">
                    {relativeTime(branch.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="inventory-footer">
        <span>
          {filtered.length} {filtered.length === 1 ? 'branch' : 'branches'}{' '}
          {query || lifecycle !== 'all' || location !== 'all'
            ? `matching · ${branches.length} in this project`
            : 'in this project'}
        </span>
        <span>Search includes every group</span>
      </div>
    </div>
  );
}
