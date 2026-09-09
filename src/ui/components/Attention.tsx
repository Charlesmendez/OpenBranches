import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import type { Repository, ReviewCommand } from '../../domain/types';
import type { ReviewBucket } from '../../domain/reviews';
import type { ReviewsController } from '../hooks/useReviews';
import { EmptyState } from './Primitives';
import { ReviewCard } from './ReviewCard';

const PAGE_SIZE = 20;
const labels: Record<ReviewBucket, string> = {
  active: 'To review',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
};
export function Attention({
  reviews,
  repositories,
  repositoryId,
  onSelect,
  onSettings,
  demo,
}: {
  reviews: ReviewsController;
  repositories: Repository[];
  repositoryId: string | null;
  onSelect: (repositoryId: string, branchId: string) => void;
  onSettings: () => void;
  demo: boolean;
}) {
  const [bucket, setBucket] = useState<ReviewBucket>('active');
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const nextFocus = useRef<string | null | undefined>(undefined);
  const scoped = (value: ReviewBucket) =>
    reviews.groups[value].filter(
      (item) => !repositoryId || item.finding.repositoryId === repositoryId,
    );
  const visible = scoped(bucket);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const items = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const decisions = reviews.state.decisions.filter(
    (decision) => !repositoryId || decision.repositoryId === repositoryId,
  );
  useLayoutEffect(() => {
    if (nextFocus.current !== undefined) {
      const target = cards.current.get(nextFocus.current ?? '') ?? heading.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
      nextFocus.current = undefined;
    }
  }, [reviews.state]);
  const decide = async (command: ReviewCommand, index: number) => {
    nextFocus.current = items[index + 1]?.finding.id ?? items[index - 1]?.finding.id ?? null;
    if (!(await reviews.decide(command))) nextFocus.current = undefined;
  };
  const movePage = (next: number) => {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="attention-content">
      <div className="advisor-callout">
        <span className="advisor-icon">
          <Sparkles size={21} />
        </span>
        <div>
          <strong>A little context goes a long way.</strong>
          <p>
            These findings use Git evidence. Codex task linking is available; AI reviews are still
            being built.
          </p>
        </div>
        <button className="secondary-button" onClick={onSettings}>
          Connections
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="review-toolbar">
        <nav className="review-filters" aria-label="Review status">
          {(Object.keys(labels) as ReviewBucket[]).map((value) => (
            <button
              key={value}
              aria-pressed={bucket === value}
              className={bucket === value ? 'selected' : ''}
              onClick={() => {
                setBucket(value);
                setPage(0);
              }}
            >
              {labels[value]}
              <span>{reviews.ready ? scoped(value).length : '…'}</span>
            </button>
          ))}
        </nav>
        {visible.length > PAGE_SIZE ? (
          <FindingPages page={currentPage} count={visible.length} onPage={movePage} top />
        ) : (
          <span>{demo ? 'Sample Git evidence' : 'Git evidence'}</span>
        )}
      </div>
      <p className="review-policy">
        Your choices stay until the evidence changes. Snoozed findings return after seven days.
      </p>
      {(reviews.error || reviews.state.error) && (
        <p className="review-error" role="alert">
          {reviews.error || reviews.state.error}
        </p>
      )}
      {reviews.connectionFailed && (
        <button className="secondary-button" onClick={reviews.retry}>
          Retry loading review choices
        </button>
      )}
      <h2 ref={heading} tabIndex={-1} className="section-kicker review-heading">
        {labels[bucket]}{' '}
        <span>
          {visible.length} {visible.length === 1 ? 'finding' : 'findings'}
        </span>
      </h2>
      {!reviews.ready ? (
        <EmptyState
          icon={LoaderCircle}
          title="Opening your review history"
          description="Your saved choices are being loaded."
        />
      ) : !visible.length ? (
        <EmptyState
          icon={bucket === 'snoozed' ? Clock3 : Check}
          title={
            bucket === 'active'
              ? 'A clear headspace'
              : bucket === 'snoozed'
                ? 'Nothing snoozed'
                : 'Nothing dismissed'
          }
          description={
            bucket === 'active'
              ? 'There’s nothing waiting for your review. New evidence will appear here.'
              : 'Findings you set aside will appear here. You can bring them back at any time.'
          }
        />
      ) : (
        <div className="recommendation-list">
          {items.map((item, index) => {
            const repo = repositories.find(
              (repository) => repository.id === item.finding.repositoryId,
            );
            return (
              <ReviewCard
                key={item.finding.id}
                item={item}
                repository={repo}
                bucket={bucket}
                now={reviews.now}
                busy={reviews.busy || !!reviews.state.error}
                register={(node) => {
                  if (node) cards.current.set(item.finding.id, node);
                  else cards.current.delete(item.finding.id);
                }}
                onSelect={onSelect}
                onDecide={(command) => void decide(command, index)}
              />
            );
          })}
        </div>
      )}
      {reviews.ready && visible.length > PAGE_SIZE && (
        <FindingPages page={currentPage} count={visible.length} onPage={movePage} />
      )}
      {!reviews.connectionFailed && (decisions.length > 0 || reviews.state.error) && (
        <button
          className="text-button reset-decisions"
          disabled={reviews.busy || !reviews.ready}
          onClick={() =>
            void reviews.reset(reviews.state.error ? undefined : (repositoryId ?? undefined))
          }
        >
          {repositoryId && !reviews.state.error
            ? 'Reset this project’s review choices'
            : 'Reset all review choices'}
        </button>
      )}
    </div>
  );
}
function FindingPages({
  page,
  count,
  onPage,
  top = false,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
  top?: boolean;
}) {
  return (
    <nav
      className={`review-pagination ${top ? 'compact' : ''}`}
      aria-label={top ? 'Finding pages at top' : 'Finding pages'}
    >
      <span>
        {page * PAGE_SIZE + 1}–{Math.min(count, (page + 1) * PAGE_SIZE)} of {count}
      </span>
      <button className="secondary-button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} />
        Previous
      </button>
      <button
        className="secondary-button"
        disabled={(page + 1) * PAGE_SIZE >= count}
        onClick={() => onPage(page + 1)}
      >
        Next
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
