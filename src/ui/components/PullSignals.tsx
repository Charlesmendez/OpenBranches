import { useState } from 'react';
import { CheckCircle2, CircleAlert, CircleDashed, ChevronDown, GitPullRequest } from 'lucide-react';
import {
  checksSummary,
  observationStale,
  type Observation,
  type PullSignals as Signals,
} from '../../domain/pullSignals';
import { relativeTime } from '../../domain/branches';
import './pullSignals.css';

const reviewLabels = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Requested changes',
  COMMENTED: 'Commented',
  DISMISSED: 'Review dismissed',
};
const resultLabels: Record<string, string> = {
  success: 'Passed',
  failure: 'Failed',
  error: 'Error',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
  action_required: 'Action required',
  startup_failure: 'Could not start',
  skipped: 'Skipped',
  neutral: 'Neutral',
  stale: 'Stale',
  queued: 'Queued',
  in_progress: 'Running',
  waiting: 'Waiting',
  pending: 'Pending',
  requested: 'Requested',
};

function SourceNote({
  value,
  demo,
  now,
  open,
}: {
  value?: Observation;
  demo: boolean;
  now: number;
  open: boolean;
}) {
  if (!value)
    return (
      <p className="signal-note">
        {demo
          ? 'This example has no recorded observation.'
          : open
            ? 'Waiting for a background read. Larger workspaces take longer to check.'
            : 'No saved observation for this PR. Open GitHub for its history.'}
      </p>
    );
  return (
    <p className="signal-note">
      {demo
        ? `Sample data${observationStale(value, now) ? ' · Saved results' : ''}`
        : value.observedAt
          ? `${observationStale(value, now) ? 'Saved results · ' : ''}Checked ${relativeTime(value.observedAt, now).toLowerCase()}`
          : 'No successful observation'}
      {!value.complete && ' · Partial coverage'}
      {value.error && <span className="signal-source-error">{value.error}</span>}
    </p>
  );
}

export function PullSignals({
  headSha,
  signals,
  demo = false,
  demoNow,
  open = true,
  unavailable = false,
}: {
  headSha: string;
  signals?: Signals;
  demo?: boolean;
  demoNow?: number;
  open?: boolean;
  unavailable?: boolean;
}) {
  const [checkPage, setCheckPage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  // Fictional snapshots have a stable demo clock and are always labeled sample data.
  const now = demo && demoNow && Number.isFinite(demoNow) ? demoNow : Date.now();
  const summary = checksSummary(headSha, signals, now);
  const sourceUnavailable = unavailable && !demo;
  const state = sourceUnavailable ? 'unknown' : summary.state;
  const checks = signals?.checks;
  const reviews = signals?.reviews;
  const currentCheckPage = Math.min(
    checkPage,
    Math.max(0, Math.ceil((checks?.items.length ?? 0) / 10) - 1),
  );
  const currentReviewPage = Math.min(
    reviewPage,
    Math.max(0, Math.ceil((reviews?.items.length ?? 0) / 10) - 1),
  );
  const Icon = state === 'passed' ? CheckCircle2 : state === 'failed' ? CircleAlert : CircleDashed;
  return (
    <details className="pull-signals">
      <summary>
        <span className={'signal-chip ' + state}>
          <Icon size={14} />
          {sourceUnavailable && checks ? 'Saved check results' : summary.label}
        </span>
        <span className="signal-review-count">
          <GitPullRequest size={13} />
          {reviews
            ? `${reviews.total} ${reviews.complete ? '' : 'observed '}${reviews.total === 1 ? 'review' : 'reviews'}`
            : 'Reviews not read yet'}
        </span>
        <ChevronDown size={14} className="signal-disclosure" />
      </summary>
      <div className="signal-detail">
        <div className="signal-detail-heading">
          <strong>Checks & submitted reviews</strong>
          <code>{(signals?.headSha ?? headSha).slice(0, 7)}</code>
        </div>
        {signals && signals.headSha !== headSha && (
          <p className="signal-note">
            These observations belong to a different PR commit. Current results are unknown.
          </p>
        )}
        {unavailable && !demo && (
          <p className="signal-note">
            The PR source is outdated or unavailable. These are saved observations.
          </p>
        )}
        <section aria-label="Reported checks">
          <h4>Reported checks{checks ? ` · ${checks.total}` : ''}</h4>
          <SourceNote value={checks} demo={demo} now={now} open={open} />
          {checks?.total === 0 && checks.complete && (
            <p className="signal-note">
              GitHub reported no checks or commit statuses for this commit.
            </p>
          )}
          <ul className="signal-rows">
            {checks?.items
              .slice(currentCheckPage * 10, (currentCheckPage + 1) * 10)
              .map((check) => (
                <li key={check.kind + ':' + check.id}>
                  <span>
                    <strong>{check.name}</strong>
                    <small>{check.kind === 'status' ? 'Commit status' : 'Check run'}</small>
                  </span>
                  <span
                    className={
                      'signal-result ' +
                      (sourceUnavailable ||
                      signals?.headSha !== headSha ||
                      (checks && observationStale(checks, now))
                        ? 'unknown'
                        : check.state)
                    }
                  >
                    {resultLabels[check.result] ?? check.result}
                  </span>
                </li>
              ))}
          </ul>
          {checks && checks.total > checks.items.length && (
            <p className="signal-note">
              Showing {checks.items.length} of {checks.total} observed checks, with failures first.
            </p>
          )}
          {checks && checks.items.length > 10 && (
            <SignalPagination
              page={currentCheckPage}
              count={checks.items.length}
              label="checks"
              onPage={setCheckPage}
            />
          )}
        </section>
        <section aria-label="Submitted reviews">
          <h4>Submitted reviews{reviews ? ` · ${reviews.total}` : ''}</h4>
          <SourceNote value={reviews} demo={demo} now={now} open={open} />
          {reviews?.total === 0 && reviews.complete && (
            <p className="signal-note">No submitted reviews were returned.</p>
          )}
          <ul className="signal-rows signal-reviews">
            {reviews?.items
              .slice(currentReviewPage * 10, (currentReviewPage + 1) * 10)
              .map((review) => (
                <li key={review.id}>
                  <span>
                    <strong>{review.actor?.login ?? 'Reviewer unavailable'}</strong>
                    <small>
                      {relativeTime(review.submittedAt, now)} ·{' '}
                      {review.commitSha === headSha
                        ? 'This PR commit'
                        : review.commitSha
                          ? `Different commit ${review.commitSha.slice(0, 7)}`
                          : 'Commit unavailable'}
                    </small>
                  </span>
                  <span className="signal-result">{reviewLabels[review.state]}</span>
                </li>
              ))}
          </ul>
          {reviews && reviews.total > reviews.items.length && (
            <p className="signal-note">
              Showing the {reviews.items.length} newest reviews in this observation.
            </p>
          )}
          {reviews && reviews.items.length > 10 && (
            <SignalPagination
              page={currentReviewPage}
              count={reviews.items.length}
              label="reviews"
              onPage={setReviewPage}
            />
          )}
        </section>
        <p className="signal-boundary">
          These are recorded results. Required checks, branch rules, and current approval
          requirements are checked on GitHub before merging.
        </p>
      </div>
    </details>
  );
}
function SignalPagination({
  page,
  count,
  label,
  onPage,
}: {
  page: number;
  count: number;
  label: string;
  onPage: (page: number) => void;
}) {
  return (
    <div className="signal-pagination">
      <button
        className="text-button"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        aria-label={`Previous ${label}`}
      >
        Previous
      </button>
      <span>
        {page + 1} / {Math.ceil(count / 10)}
      </span>
      <button
        className="text-button"
        disabled={(page + 1) * 10 >= count}
        onClick={() => onPage(page + 1)}
        aria-label={`Next ${label}`}
      >
        Next
      </button>
    </div>
  );
}
