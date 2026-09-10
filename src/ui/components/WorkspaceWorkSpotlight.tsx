import { useEffect, useState } from 'react';
import { CircleDot } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { activeWorkspaceSpotlights } from '../../domain/workSpotlight';
import { WorkSpotlightCard } from './WorkSpotlightCard';

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
  const [requestedPage, setRequestedPage] = useState(0);
  const spotlights = activeWorkspaceSpotlights(repositories, now);
  const live = spotlights.filter(({ signal }) => signal.kind === 'live').length;
  const waiting = spotlights.length - live;

  const canExpand = spotlights.length > COLLAPSED_LIMIT;
  const showingPages = expanded && canExpand;
  const pageCount = Math.max(1, Math.ceil(spotlights.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1);
  const pageStart = page * PAGE_SIZE;
  const shown = showingPages
    ? spotlights.slice(pageStart, pageStart + PAGE_SIZE)
    : spotlights.slice(0, COLLAPSED_LIMIT);
  const summary = [live ? `${live} live` : '', waiting ? `${waiting} waiting for input` : '']
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    setRequestedPage((value) => Math.min(value, pageCount - 1));
    if (!canExpand) setExpanded(false);
  }, [canExpand, pageCount]);

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
              setRequestedPage(0);
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
      {showingPages && pageCount > 1 && (
        <div className="workspace-work-pagination" aria-label="Active work pages">
          <button
            className="text-button"
            disabled={page === 0}
            onClick={() => setRequestedPage((value) => Math.max(0, value - 1))}
          >
            Previous
          </button>
          <span>
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, spotlights.length)} of{' '}
            {spotlights.length}
          </span>
          <button
            className="text-button"
            disabled={page >= pageCount - 1}
            onClick={() => setRequestedPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
