import { CircleDot } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { workSpotlights } from '../../domain/workSpotlight';
import { useClock } from '../hooks/useClock';
import { WorkSpotlightCard } from './WorkSpotlightCard';

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
        {shown.map(({ branch, signal }) => (
          <WorkSpotlightCard
            key={branch.id}
            repository={repository}
            branch={branch}
            signal={signal}
            onOpen={() => onFocus(branch)}
          />
        ))}
      </div>
      {spotlights.length > shown.length && (
        <span className="project-work-more">+{spotlights.length - shown.length} more</span>
      )}
    </section>
  );
}
