import {
  Check,
  GitBranch,
  Laptop,
  CircleHelp,
  Minus,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { Branch, IntegrationState, Repository } from '../../domain/types';
import type { ReactNode } from 'react';
import brand from '../../../assets/brand.svg';
import { remoteEvidenceLabel, remoteIdentity } from '../../domain/remotes';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <img src={brand} width={28} height={28} alt="" />
      {!compact && (
        <span>
          Open<span className="brand-light">Branches</span>
        </span>
      )}
    </span>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  children,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      className={`icon-button ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={17} />
      {children}
    </button>
  );
}
export function Locations({
  branch,
  repository,
  compact = false,
}: {
  branch: Branch;
  repository: Pick<Repository, 'remotes'>;
  compact?: boolean;
}) {
  const local = !!branch.local || branch.detached;
  const remote = remoteIdentity(repository, branch);
  const availableCopies = branch.worktrees.filter((tree) => tree.available).length;
  const missingCopies = branch.worktrees.length - availableCopies;
  const localLabel = [
    availableCopies
      ? `${availableCopies} available ${availableCopies === 1 ? 'worktree' : 'worktrees'} on this Mac`
      : 'Local branch ref; not checked out',
    missingCopies
      ? `${missingCopies} ${missingCopies === 1 ? 'worktree is' : 'worktrees are'} missing from disk`
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  const remoteLabel = remote ? remoteEvidenceLabel(remote, true) : '';
  return (
    <span
      className="locations"
      title={
        remote
          ? `${local ? `${localLabel}; ` : ''}${remoteLabel}${remote.destination ? ` (${remote.destination})` : ''}`
          : `${localLabel}; Git remote association not found in this scan`
      }
    >
      {local && (
        <span>
          <Laptop size={14} />
          {!compact &&
            (availableCopies > 1
              ? `${availableCopies} worktrees`
              : availableCopies === 1
                ? 'This Mac'
                : 'Ref on this Mac')}
          {compact && (availableCopies ? 'Mac' : 'Mac ref')}
          {compact && availableCopies > 1 && <small>{availableCopies}</small>}
        </span>
      )}
      {missingCopies > 0 && (
        <span className="location-missing" title={localLabel}>
          <TriangleAlert size={12} />
          {!compact && `${missingCopies} missing`}
          {compact && <small>{missingCopies}</small>}
        </span>
      )}
      {local && remote && <span className="location-plus">·</span>}
      {remote && (
        <span className="location-remote">
          <Upload size={14} />
          <span>{compact ? remote.name : remoteEvidenceLabel(remote)}</span>
          {remote.host && <code>{remote.host}</code>}
        </span>
      )}
    </span>
  );
}
export function IntegrationBadge({
  state,
  label,
}: {
  state: IntegrationState | undefined;
  label?: string;
}) {
  const Icon = state === 'integrated' ? Check : state === 'pending' ? Minus : CircleHelp;
  return (
    <span className={`integration-badge ${state ?? 'unknown'}`}>
      <Icon size={12} />
      {label ??
        (state === 'integrated'
          ? 'Integrated'
          : state === 'pending'
            ? 'Not in history'
            : 'Unknown')}
    </span>
  );
}
export function BranchStatus({
  branch,
  repository,
}: {
  branch: Branch;
  repository: Pick<Repository, 'remotes'>;
}) {
  if (branch.pullRequest?.state === 'open')
    return (
      <span className="pill violet">
        PR #{branch.pullRequest.number} · {branch.pullRequest.draft ? 'Draft' : 'In review'}
      </span>
    );
  if (branch.worktrees.some((w) => w.dirty))
    return <span className="pill amber">Uncommitted work</span>;
  if (branch.pullRequest?.state === 'merged')
    return (
      <span className="pill blue">
        <Check size={12} />
        PR merged into {branch.pullRequest.base}
      </span>
    );
  const integrated = Object.entries(branch.integration).filter(
    ([, state]) => state === 'integrated',
  );
  if (integrated.length)
    return (
      <span className="pill blue">
        <Check size={12} />
        In {integrated.map(([target]) => target).join(' + ')}
      </span>
    );
  if (!branch.remote) return <span className="pill amber">Local branch</span>;
  const remote = remoteIdentity(repository, branch)!;
  return (
    <span className="pill neutral" title={remote.destination ?? remote.url}>
      {branch.local && 'On this Mac · '}
      {remoteEvidenceLabel(remote, true)}
    </span>
  );
}
export function EmptyState({
  icon: Icon = GitBranch,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={24} strokeWidth={1.4} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
