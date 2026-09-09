import { ArrowUpRight, Clock3, GitBranch, Laptop, Pause, RotateCcw } from 'lucide-react';
import type { Repository, ReviewCommand } from '../../domain/types';
import type { ReviewBucket, ReviewedFinding } from '../../domain/reviews';
import { relativeTime } from '../../domain/branches';

export function ReviewCard({
  item,
  repository,
  bucket,
  now,
  busy,
  register,
  onSelect,
  onDecide,
}: {
  item: ReviewedFinding;
  repository?: Repository;
  bucket: ReviewBucket;
  now: number;
  busy: boolean;
  register: (node: HTMLElement | null) => void;
  onSelect: (repositoryId: string, branchId: string) => void;
  onDecide: (command: ReviewCommand) => void;
}) {
  const { finding, decision, changed } = item;
  const branch = repository?.branches.find((value) => value.id === finding.branchId);
  const Icon =
    finding.category === 'local-only'
      ? Laptop
      : finding.category === 'forgotten'
        ? Clock3
        : GitBranch;
  const choose = (choice: ReviewCommand['choice']) =>
    onDecide({ id: finding.id, revision: finding.revision, choice });
  return (
    <article
      ref={register}
      tabIndex={-1}
      className={`recommendation-card ${finding.priority}`}
      aria-label={`${finding.title}: ${branch?.title ?? 'branch'}`}
    >
      <span className="recommendation-icon">
        <Icon size={19} />
      </span>
      <div className="recommendation-body">
        <div className="recommendation-context">
          {repository?.name}
          <span>/</span>
          {branch?.title}
          <span className="recommendation-checked">{relativeTime(finding.checkedAt, now)}</span>
        </div>
        {changed && <span className="review-changed">New evidence since your last review</span>}
        {bucket === 'snoozed' && decision?.until && (
          <span className="review-changed">
            Returns{' '}
            {new Date(decision.until).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
        <h3>{finding.title}</h3>
        <p>{finding.explanation}</p>
        <details>
          <summary>Why this appeared</summary>
          <ul>
            {finding.evidence.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </details>
        <div className="recommendation-actions">
          <button
            className="text-button"
            onClick={() => onSelect(finding.repositoryId, finding.branchId)}
          >
            Inspect branch
            <ArrowUpRight size={14} />
          </button>
          {bucket === 'active' ? (
            <>
              <button disabled={busy} onClick={() => choose('snoozed')}>
                <Pause size={13} />
                Snooze 7 days
              </button>
              <button disabled={busy} onClick={() => choose('dismissed')}>
                Dismiss
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={() => choose('restore')}>
              <RotateCcw size={13} />
              Show in To review
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
