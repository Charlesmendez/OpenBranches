import {
  ArrowUpRight,
  CircleDot,
  FilePenLine,
  GitCommitHorizontal,
  Laptop,
  MessageCircleQuestion,
  Radio,
} from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { workSpotlights, type WorkSignalKind } from '../../domain/workSpotlight';
import { useClock } from '../hooks/useClock';
import { ToolIcon } from './AgentBadges';

const icons = {
  live: Radio,
  waiting: MessageCircleQuestion,
  changes: FilePenLine,
  recent: GitCommitHorizontal,
  checkout: Laptop,
} satisfies Record<WorkSignalKind, typeof Radio>;

export function ProjectWorkSpotlight({
  repository,
  branches,
  onFocus,
}: {
  repository: Repository;
  branches: Branch[];
  onFocus: (branch: Branch) => void;
}) {
  const now = useClock();
  const spotlights = workSpotlights(branches, repository.path, now);
  if (!spotlights.length) return null;

  const shown = spotlights.slice(0, 2);
  const live = spotlights.filter(({ signal }) => signal.kind === 'live').length;
  const waiting = spotlights.filter(({ signal }) => signal.kind === 'waiting').length;
  const tone = live ? 'live' : waiting ? 'waiting' : spotlights[0].signal.kind;
  const title = live
    ? `${live} ${live === 1 ? 'branch is' : 'branches are'} live now`
    : waiting
      ? `${waiting} ${waiting === 1 ? 'branch needs' : 'branches need'} input`
      : spotlights[0].signal.kind === 'changes'
        ? 'Work in progress on this Mac'
        : spotlights[0].signal.kind === 'recent'
          ? 'Recently active work'
          : 'Your current checkout';

  return (
    <section className={`project-work-spotlight ${tone}`} aria-label="Current project work">
      <div className="project-work-intro">
        <span className="project-work-kicker">
          <CircleDot size={12} />
          {live ? 'HAPPENING NOW' : waiting ? 'NEEDS YOU' : 'CURRENT WORK'}
        </span>
        <strong>{title}</strong>
        <small>Select a branch to focus it on the map.</small>
      </div>
      <div className="project-work-items">
        {shown.map(({ branch, signal }) => {
          const Icon = icons[signal.kind];
          return (
            <button
              key={branch.id}
              className={`project-work-item ${signal.kind}`}
              title={signal.detail}
              onClick={() => onFocus(branch)}
            >
              <span className="project-work-icon">
                {signal.tools.length ? (
                  signal.tools.slice(0, 2).map((tool) => <ToolIcon key={tool} tool={tool} />)
                ) : (
                  <Icon size={15} />
                )}
              </span>
              <span className="project-work-copy">
                <strong>{branch.title}</strong>
                <code>{branch.name}</code>
                <small>{signal.label}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          );
        })}
      </div>
      {spotlights.length > shown.length && (
        <span className="project-work-more">+{spotlights.length - shown.length} more</span>
      )}
    </section>
  );
}
