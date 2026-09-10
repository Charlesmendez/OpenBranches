import { CircleDot } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { workSpotlights } from '../../domain/workSpotlight';
import { useClock } from '../hooks/useClock';
import { WorkSpotlightCard } from './WorkSpotlightCard';
import { CompactPager } from './CompactPager';
import { usePageWindow } from '../hooks/usePageWindow';

const PAGE_SIZE = 2;

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
  const spotlightKey = spotlights
    .map(({ branch, signal }) => `${branch.id}:${signal.kind}:${signal.label}`)
    .join('|');
  const current = usePageWindow(spotlights, PAGE_SIZE, `${repository.id}:${spotlightKey}`);
  const live = spotlights.filter(({ signal }) => signal.kind === 'live').length;
  const waiting = spotlights.filter(({ signal }) => signal.kind === 'waiting').length;
  const primaryKind = spotlights[0]?.signal.kind;
  const tone = live ? 'live' : waiting ? 'waiting' : (primaryKind ?? 'checkout');
  const title = live
    ? live === 1
      ? spotlights[0].signal.label
      : `${live} branches are active now${waiting ? ` · ${waiting} waiting` : ''}`
    : waiting
      ? `${waiting} ${waiting === 1 ? 'branch needs' : 'branches need'} input`
      : primaryKind === 'changes'
        ? 'This checkout has work in progress'
        : primaryKind === 'recent'
          ? 'Recently active work'
          : 'Your current checkout';
  const guidance = live
    ? 'Choose a branch and the map will jump straight to it.'
    : waiting
      ? 'Choose a branch to see what is waiting and where it will land.'
      : primaryKind === 'changes'
        ? 'This is the strongest local signal. Live detection adds the coding agent.'
        : 'Choose a branch to center it on the map.';

  if (!spotlights.length) return null;

  return (
    <section className={`project-work-spotlight ${tone}`} aria-label="Current project work">
      <div className="project-work-intro">
        <span className="project-work-kicker">
          <CircleDot size={12} />
          {live ? 'LIVE IN THIS PROJECT' : waiting ? 'NEEDS YOU' : 'CURRENT WORK'}
        </span>
        <strong>{title}</strong>
        <small>{guidance}</small>
      </div>
      <div className={`project-work-items ${current.items.length === 1 ? 'single' : ''}`}>
        {current.items.map(({ branch, signal }) => (
          <WorkSpotlightCard
            key={branch.id}
            repository={repository}
            branch={branch}
            signal={signal}
            onOpen={() => onFocus(branch)}
          />
        ))}
      </div>
      {spotlights.length > PAGE_SIZE && (
        <CompactPager
          page={current.page}
          pageSize={PAGE_SIZE}
          count={spotlights.length}
          label="Current work pages"
          className="project-work-pagination"
          onPage={current.setPage}
        />
      )}
    </section>
  );
}
