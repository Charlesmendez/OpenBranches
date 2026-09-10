import { useEffect, useMemo, useRef, useState } from 'react';
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
  Send,
  X,
} from 'lucide-react';
import type { AgentHandoff, CodexStatus, Repository, ReviewCommand } from '../../domain/types';
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
import { AgentHandoffDialog } from './AgentHandoffDialog';
import { HandoffActivity } from './HandoffActivity';
import { useHandoffs } from '../hooks/useHandoffs';
import { CompactPager } from './CompactPager';
import { usePageWindow } from '../hooks/usePageWindow';

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
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [showSelected, setShowSelected] = useState(false);
  const [handoffItems, setHandoffItems] = useState<TriageItem[] | null>(null);
  const selectVisible = useRef<HTMLInputElement>(null);
  const handoffs = useHandoffs(demo);
  const handoffByBranch = useMemo(() => {
    const result = new Map<string, AgentHandoff>();
    for (const handoff of handoffs.state.handoffs) {
      for (const branchId of handoff.branchIds) {
        const key = `${handoff.repositoryId}\u0000${branchId}`;
        if (!result.has(key)) result.set(key, handoff);
      }
    }
    return result;
  }, [handoffs.state.handoffs]);
  const handoffSelections = useMemo(
    () =>
      handoffItems?.map((item) => ({
        repositoryId: item.repositoryId,
        branchId: item.id,
      })) ?? [],
    [handoffItems],
  );
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
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const needle = query.trim().toLowerCase();
  const matching = all.filter(
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
  const filtered = showSelected ? all.filter((item) => selectedSet.has(item.id)) : matching;
  const overview = bucket === 'active' && !queue && !needle && !showSelected;
  const pageKey = [
    bucket,
    queue ?? '',
    needle,
    showSelected ? 'selected' : 'matching',
    ...filtered.map(
      (item) =>
        `${item.repositoryId}:${item.id}:${item.updatedAt}:${item.findings
          .map(({ finding }) => finding.revision)
          .join(',')}`,
    ),
  ].join('\u0001');
  const current = usePageWindow(filtered, PAGE_SIZE, pageKey);
  const items = overview ? triageHighlights(all) : current.items;
  const selectedItems = all.filter((item) => selectedSet.has(item.id));
  const selectedVisibleItems = items.filter((item) => selectedSet.has(item.id));
  const selectedFilteredItems = filtered.filter((item) => selectedSet.has(item.id));
  const hiddenSelectionCount = selectedItems.length - selectedVisibleItems.length;
  const allFilteredSelected =
    filtered.length > 0 && selectedFilteredItems.length === filtered.length;
  const selectedProjectCount = new Set(selectedItems.map((item) => item.repositoryId)).size;
  const selectedActiveHandoffCount = selectedItems.filter((item) => {
    const handoff = handoffByBranch.get(`${item.repositoryId}\u0000${item.id}`);
    return handoff?.state === 'queued' || handoff?.state === 'running';
  }).length;
  useEffect(() => {
    if (selectVisible.current)
      selectVisible.current.indeterminate =
        selectedVisibleItems.length > 0 && selectedVisibleItems.length < items.length;
  }, [items.length, selectedVisibleItems.length]);
  const busy = reviews.busy || !!reviews.state.error || !reviews.ready;
  const choose = async (items: TriageItem[], choice: ReviewCommand['choice']) => {
    const commands = items.flatMap((item) =>
      item.findings.map(({ finding }) => ({ id: finding.id, revision: finding.revision, choice })),
    );
    if (await reviews.decideMany(commands)) {
      setSelected([]);
      setShowSelected(false);
    }
  };
  const change = (next: TriageQueue | 'all' | null) => {
    setQueue(next);
    setShowSelected(false);
  };
  useEffect(() => {
    setSelected([]);
    setShowSelected(false);
  }, [repositoryId]);
  useEffect(() => {
    if (showSelected && selectedItems.length === 0) setShowSelected(false);
  }, [selectedItems.length, showSelected]);
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
      <HandoffActivity
        handoffs={handoffs.state.handoffs}
        repositoryId={repositoryId}
        now={reviews.now}
      />
      <div className="review-toolbar">
        <nav className="review-filters" aria-label="Review status">
          {(Object.keys(labels) as ReviewBucket[]).map((value) => (
            <button
              key={value}
              aria-pressed={bucket === value}
              className={bucket === value ? 'selected' : ''}
              onClick={() => {
                setBucket(value);
                setSelected([]);
                setShowSelected(false);
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
              setShowSelected(false);
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
              {(queue || showSelected) && (
                <button
                  className="text-button"
                  onClick={() => {
                    setShowSelected(false);
                    if (queue) setQueue(null);
                  }}
                >
                  <ArrowLeft size={13} />
                  {showSelected ? 'Back to review' : 'All queues'}
                </button>
              )}
              <h2>
                {showSelected
                  ? 'Selected branches'
                  : overview
                    ? 'Start here'
                    : queue && queue !== 'all'
                      ? triageQueues[queue].title
                      : `${labels[bucket]} branches`}
              </h2>
              <span>
                {showSelected
                  ? `${filtered.length} selected ${filtered.length === 1 ? 'branch' : 'branches'}`
                  : overview
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
              <div className="triage-bulk-summary">
                <strong>
                  {selectedItems.length} selected
                  {selectedProjectCount > 1 ? ` across ${selectedProjectCount} projects` : ''}
                </strong>
                {hiddenSelectionCount > 0 && (
                  <span>{hiddenSelectionCount} selected outside this page</span>
                )}
              </div>
              {hiddenSelectionCount > 0 && !showSelected && (
                <button
                  className="text-button triage-show-selected"
                  onClick={() => {
                    setQuery('');
                    setQueue(null);
                    setShowSelected(true);
                  }}
                >
                  Show selected
                </button>
              )}
              {bucket === 'active' ? (
                <>
                  <button
                    className="primary-button triage-send-selected"
                    disabled={
                      busy ||
                      handoffs.busy ||
                      !handoffs.ready ||
                      demo ||
                      selectedActiveHandoffCount > 0
                    }
                    title={
                      selectedActiveHandoffCount
                        ? `${selectedActiveHandoffCount} selected ${selectedActiveHandoffCount === 1 ? 'branch is' : 'branches are'} already with an agent.`
                        : undefined
                    }
                    onClick={() => setHandoffItems(selectedItems)}
                  >
                    <Send size={13} />
                    Send all {selectedItems.length} to…
                  </button>
                  {selectedActiveHandoffCount > 0 && (
                    <span className="triage-bulk-note">
                      Unselect {selectedActiveHandoffCount} already with an agent to send this
                      batch.
                    </span>
                  )}
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
              <button
                className="text-button"
                onClick={() => {
                  setSelected([]);
                  setShowSelected(false);
                }}
              >
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
                    ref={selectVisible}
                    type="checkbox"
                    aria-label="Select visible review branches"
                    checked={items.length > 0 && selectedVisibleItems.length === items.length}
                    onChange={(event) => {
                      const visibleIds = new Set(items.map((item) => item.id));
                      setSelected((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, ...visibleIds])]
                          : previous.filter((id) => !visibleIds.has(id)),
                      );
                    }}
                  />
                  Select visible
                </label>
                {filtered.length > items.length && (
                  <button
                    className="text-button triage-select-results"
                    onClick={() => {
                      const filteredIds = new Set(filtered.map((item) => item.id));
                      setSelected((previous) =>
                        allFilteredSelected
                          ? previous.filter((id) => !filteredIds.has(id))
                          : [...new Set([...previous, ...filteredIds])],
                      );
                    }}
                  >
                    {allFilteredSelected ? 'Clear' : 'Select all'} {filtered.length} results
                  </button>
                )}
                <span>One row per branch · expand for evidence</span>
              </div>
              {items.map((item) => (
                <TriageRow
                  key={item.id}
                  item={item}
                  branch={branchById.get(item.id)}
                  projectName={repoById.get(item.repositoryId)?.name}
                  now={reviews.now}
                  selected={selectedSet.has(item.id)}
                  busy={busy}
                  bucket={bucket}
                  handoff={handoffByBranch.get(`${item.repositoryId}\u0000${item.id}`)}
                  canSend={
                    !demo &&
                    handoffs.ready &&
                    !['queued', 'running'].includes(
                      handoffByBranch.get(`${item.repositoryId}\u0000${item.id}`)?.state ?? '',
                    )
                  }
                  onSelection={(checked) =>
                    setSelected((previous) =>
                      checked
                        ? [...new Set([...previous, item.id])]
                        : previous.filter((id) => id !== item.id),
                    )
                  }
                  onInspect={() => onSelect(item.repositoryId, item.id)}
                  onSend={() => setHandoffItems([item])}
                  onChoose={(choice) => choose([item], choice)}
                />
              ))}
            </div>
          )}
          {!overview && filtered.length > PAGE_SIZE && (
            <CompactPager
              page={current.page}
              pageSize={PAGE_SIZE}
              count={filtered.length}
              label="Review branch pages"
              className="review-pagination"
              onPage={current.setPage}
            />
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
      {handoffItems && handoffSelections.length > 0 && (
        <AgentHandoffDialog
          selections={handoffSelections}
          handoffs={handoffs}
          close={() => setHandoffItems(null)}
          sent={() => {
            setHandoffItems(null);
            setSelected([]);
            setShowSelected(false);
          }}
        />
      )}
    </div>
  );
}
