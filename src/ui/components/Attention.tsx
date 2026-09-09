import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  GitBranch,
  Laptop,
  LoaderCircle,
  Pause,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type { CodexStatus, Repository, ReviewCommand } from '../../domain/types';
import type { ReviewBucket } from '../../domain/reviews';
import {
  triageFindings,
  triageHighlights,
  triageQueues,
  type TriageItem,
  type TriageQueue,
} from '../../domain/triage';
import type { ReviewsController } from '../hooks/useReviews';
import { TriageRow } from './TriageRow';
import { EmptyState } from './Primitives';

const PAGE_SIZE = 12;
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
  codex,
}: {
  reviews: ReviewsController;
  repositories: Repository[];
  repositoryId: string | null;
  onSelect: (repositoryId: string, branchId: string) => void;
  onSettings: () => void;
  demo: boolean;
  codex: CodexStatus;
}) {
  const [bucket, setBucket] = useState<ReviewBucket>('active');
  const [queue, setQueue] = useState<TriageQueue | 'all' | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const groups = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(labels) as ReviewBucket[]).map((value) => [
          value,
          triageFindings(
            reviews.groups[value].filter(
              (item) => !repositoryId || item.finding.repositoryId === repositoryId,
            ),
            repositories,
          ),
        ]),
      ) as Record<ReviewBucket, TriageItem[]>,
    [reviews.groups, repositories, repositoryId],
  );
  const all = groups[bucket];
  const repoById = new Map(repositories.map((repo) => [repo.id, repo]));
  const branchById = new Map(
    repositories.flatMap((repo) => repo.branches.map((branch) => [branch.id, branch] as const)),
  );
  const needle = query.trim().toLowerCase();
  const filtered = all.filter(
    (item) =>
      (!queue || queue === 'all' || item.queue === queue) &&
      (!needle ||
        [
          repoById.get(item.repositoryId)?.name,
          branchById.get(item.id)?.name,
          branchById.get(item.id)?.title,
          ...item.findings.map((value) => value.finding.explanation),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  );
  const overview = bucket === 'active' && !queue && !needle;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const items = overview
    ? triageHighlights(all)
    : filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const busy = reviews.busy || !!reviews.state.error || !reviews.ready;
  const choose = async (items: TriageItem[], choice: ReviewCommand['choice']) => {
    const commands = items.flatMap((item) =>
      item.findings.map(({ finding }) => ({ id: finding.id, revision: finding.revision, choice })),
    );
    if (await reviews.decideMany(commands)) setSelected([]);
  };
  const change = (next: TriageQueue | 'all' | null) => {
    setQueue(next);
    setPage(0);
    setSelected([]);
  };
  const linked = codex.enabled && (codex.state === 'ready' || codex.state === 'connecting');
  const activeQueues = (Object.keys(triageQueues) as TriageQueue[]).filter((key) =>
    groups.active.some((item) => item.queue === key),
  );
  return (
    <div className="attention-content">
      <div className="review-source-status">
        <span>
          <i className={`status-dot ${linked ? '' : 'muted'}`} />
          {demo
            ? 'Demo evidence'
            : linked
              ? `Codex connected · ${codex.taskCount ?? 0} linked tasks${codex.state === 'connecting' ? ' · syncing' : ''}`
              : codex.enabled
                ? 'Codex connection needs attention · saved evidence available'
                : 'Git evidence connected'}
        </span>
        <button className="text-button" onClick={onSettings}>
          {linked ? 'Connection details' : 'Connect an agent'}
          <ArrowUpRight size={13} />
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
                change(null);
              }}
            >
              {labels[value]}
              <span>{reviews.ready ? groups[value].length : '…'}</span>
            </button>
          ))}
        </nav>
        <label className="triage-search">
          <Search size={15} />
          <input
            aria-label="Search review branches"
            placeholder="Search branches or projects…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
              setSelected([]);
            }}
          />
          {query && (
            <button aria-label="Clear review search" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
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
      {!reviews.ready ? (
        <EmptyState
          icon={LoaderCircle}
          title="Opening review history"
          description="Loading your saved choices."
        />
      ) : (
        <>
          {overview && (
            <>
              <div className="triage-intro">
                <h2>
                  {activeQueues.length
                    ? `${activeQueues.length} review queues. Start with one.`
                    : 'Nothing waiting for review.'}
                </h2>
                <p>
                  {all.length
                    ? `${all.length} branches grouped by the decision to make. Age alone is not an emergency.`
                    : 'New evidence will appear here as your projects change.'}
                </p>
              </div>
              <div className="triage-queues">
                {activeQueues.map((key) => {
                  const count = all.filter((item) => item.queue === key).length;
                  const Icon = key === 'unpublished' ? Laptop : key === 'idle' ? Clock3 : GitBranch;
                  return (
                    <button key={key} className={`triage-queue ${key}`} onClick={() => change(key)}>
                      <div>
                        <Icon size={19} />
                        <span>{count} branches</span>
                      </div>
                      <strong>{triageQueues[key].title}</strong>
                      <p>{triageQueues[key].description}</p>
                      <span className="queue-open">
                        Review queue
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="triage-list-heading">
            <div>
              {queue && (
                <button className="text-button" onClick={() => change(null)}>
                  <ArrowLeft size={13} />
                  All queues
                </button>
              )}
              <h2>
                {overview
                  ? 'Start here'
                  : queue && queue !== 'all'
                    ? triageQueues[queue].title
                    : `${labels[bucket]} branches`}
              </h2>
              <span>
                {overview
                  ? repositoryId
                    ? 'Up to five suggestions for this project'
                    : 'Up to five suggestions, spread across your projects'
                  : `${filtered.length} ${filtered.length === 1 ? 'branch' : 'branches'}`}
              </span>
            </div>
            {overview && all.length > items.length && (
              <button className="text-button" onClick={() => change('all')}>
                See all {all.length}
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
          {selectedItems.length > 0 && (
            <div className="triage-bulk" role="status">
              <strong>{selectedItems.length} selected</strong>
              {bucket === 'active' ? (
                <>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void choose(selectedItems, 'snoozed')}
                  >
                    <Pause size={13} />
                    Snooze 7 days
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void choose(selectedItems, 'dismissed')}
                  >
                    Dismiss selected
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void choose(selectedItems, 'restore')}
                >
                  <RotateCcw size={13} />
                  Restore selected
                </button>
              )}
              <button className="text-button" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          )}
          {!items.length ? (
            <EmptyState
              icon={Check}
              title={
                needle
                  ? 'No matching branches'
                  : bucket === 'active'
                    ? 'Nothing to review here'
                    : `Nothing ${labels[bucket].toLowerCase()}`
              }
              description={
                needle
                  ? 'Try a branch name or project.'
                  : 'Your saved choices stay until the evidence changes.'
              }
            />
          ) : (
            <div className="triage-list">
              <div className="triage-list-header">
                <label>
                  <input
                    type="checkbox"
                    aria-label="Select visible review branches"
                    checked={items.length > 0 && selectedItems.length === items.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? items.map((item) => item.id) : [])
                    }
                  />
                  Select visible
                </label>
                <span>One row per branch · expand for evidence</span>
              </div>
              {items.map((item) => (
                <TriageRow
                  key={item.id}
                  item={item}
                  branch={branchById.get(item.id)}
                  projectName={repoById.get(item.repositoryId)?.name}
                  now={reviews.now}
                  selected={selected.includes(item.id)}
                  busy={busy}
                  bucket={bucket}
                  onSelection={(checked) =>
                    setSelected((previous) =>
                      checked
                        ? [...new Set([...previous, item.id])]
                        : previous.filter((id) => id !== item.id),
                    )
                  }
                  onInspect={() => onSelect(item.repositoryId, item.id)}
                  onChoose={(choice) => choose([item], choice)}
                />
              ))}
            </div>
          )}
          {!overview && filtered.length > PAGE_SIZE && (
            <nav className="review-pagination" aria-label="Review branch pages">
              <span>
                {currentPage * PAGE_SIZE + 1}–
                {Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE)} of {filtered.length}
              </span>
              <button
                className="secondary-button"
                disabled={currentPage === 0}
                onClick={() => {
                  setPage(currentPage - 1);
                  setSelected([]);
                }}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
                onClick={() => {
                  setPage(currentPage + 1);
                  setSelected([]);
                }}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
      <p className="review-policy">
        Snoozing hides a branch for seven days. Dismissing hides it until the evidence changes.
        Neither action changes Git.
      </p>
      {reviews.state.decisions.length > 0 && (
        <button
          className="text-button reset-decisions"
          disabled={busy}
          onClick={() => void reviews.reset(repositoryId ?? undefined)}
        >
          Reset {repositoryId ? 'this project’s' : 'all'} review choices
        </button>
      )}
    </div>
  );
}
