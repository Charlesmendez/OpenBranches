import { useEffect, useState } from 'react';
import { CircleDot } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { activeWorkspaceSpotlights } from '../../domain/workSpotlight';
import { WorkSpotlightCard } from './WorkSpotlightCard';
import { CompactPager } from './CompactPager';
import { usePageWindow } from '../hooks/usePageWindow';

const COLLAPSED_LIMIT = 3;
const PAGE_SIZE = 6;

export function WorkspaceWorkSpotlight({
  repositories,
  now,
  onFocus,
}: {
  repositories: Repository[];
  now: number;
  onFocus: (repository: Repository, branch: Branch) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const spotlights = activeWorkspaceSpotlights(repositories, now);
  const live = spotlights.filter(({ signal }) => signal.kind === 'live').length;
  const waiting = spotlights.length - live;

  const canExpand = spotlights.length > COLLAPSED_LIMIT;
  const showingPages = expanded && canExpand;
  const spotlightKey = spotlights
    .map(({ repository, branch, signal }) =>
      [repository.id, branch.id, signal.kind, signal.label].join(':'),
    )
    .join('|');
  const current = usePageWindow(spotlights, PAGE_SIZE, spotlightKey);
  const shown = showingPages ? current.items : spotlights.slice(0, COLLAPSED_LIMIT);
  const summary = [live ? `${live} live` : '', waiting ? `${waiting} waiting for input` : '']
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    if (!canExpand) setExpanded(false);
  }, [canExpand]);

  if (!spotlights.length) return null;

  return (
    <section
      className={`workspace-work-spotlight ${live ? 'live' : 'waiting'}`}
      aria-label="Active work across projects"
    >
      <div className="workspace-work-heading">
        <span className="project-work-kicker">
          <CircleDot size={12} />
          {live ? 'LIVE ACROSS PROJECTS' : 'AGENTS NEED YOU'}
        </span>
        <div className="workspace-work-title">
          <strong>{summary}</strong>
          <small>Open the exact branch on its map.</small>
        </div>
        {canExpand && (
          <button
            className="text-button workspace-work-toggle"
            aria-expanded={showingPages}
            onClick={() => {
              setExpanded((value) => !value);
              current.setPage(0);
            }}
          >
            {showingPages ? 'Collapse' : `Browse all ${spotlights.length}`}
          </button>
        )}
      </div>
      <div className="workspace-work-items">
        {shown.map(({ repository, branch, signal }) => (
          <WorkSpotlightCard
            key={`${repository.id}:${branch.id}`}
            repository={repository}
            branch={branch}
            signal={signal}
            showRepository
            onOpen={() => onFocus(repository, branch)}
          />
        ))}
      </div>
      {showingPages && current.pageCount > 1 && (
        <CompactPager
          page={current.page}
          pageSize={PAGE_SIZE}
          count={spotlights.length}
          label="Active work pages"
          className="workspace-work-pagination"
          onPage={current.setPage}
        />
      )}
    </section>
  );
}
