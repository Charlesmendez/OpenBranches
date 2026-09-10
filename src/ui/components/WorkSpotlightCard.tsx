import { ArrowUpRight } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import type { WorkSignal } from '../../domain/workSpotlight';
import { BranchTargetSummary } from './BranchTargetSummary';
import { WorkSignalIcon } from './WorkSignalIcon';

export function WorkSpotlightCard({
  repository,
  branch,
  signal,
  showRepository = false,
  onOpen,
}: {
  repository: Repository;
  branch: Branch;
  signal: WorkSignal;
  showRepository?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={`project-work-item ${signal.kind}`}
      title={signal.detail}
      aria-label={`${signal.label}: ${branch.title} in ${repository.name}. Open on map.`}
      onClick={onOpen}
    >
      <span className="project-work-icon">
        <WorkSignalIcon signal={signal} />
      </span>
      <span className="project-work-copy">
        {showRepository && <span className="project-work-repository">{repository.name}</span>}
        <strong>{branch.title}</strong>
        <code>{branch.name}</code>
        <small>{signal.label}</small>
        <BranchTargetSummary branch={branch} targets={repository.targets} />
      </span>
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}
