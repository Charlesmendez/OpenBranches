import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GitBranch,
  Inbox,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  X,
} from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import type {
  AttentionBucket,
  AttentionDecisionCommand,
  AttentionItem,
  AttentionKind,
} from '../../src/team/attention';
import type { TeamPage } from '../../src/team/responses';
import { useAction, useAttentionData } from './hooks';
import { dateLabel, Notice } from './primitives';
import { AttentionRow } from './AttentionRow';
import './attention.css';

const signalOptions: Array<{
  kind: AttentionKind;
  label: string;
  count: keyof NonNullable<ReturnType<typeof useAttentionData>['data']>['signals'];
  icon: typeof GitBranch;
  tone: string;
}> = [
  {
    kind: 'checks-failing',
    label: 'Failing checks',
    count: 'failingChecks',
    icon: AlertTriangle,
    tone: 'danger',
  },
  {
    kind: 'review-requested',
    label: 'Review requested',
    count: 'reviewRequested',
    icon: UserRoundCheck,
    tone: 'review',
  },
  { kind: 'stale-draft', label: 'Quiet drafts', count: 'staleDrafts', icon: Clock3, tone: 'quiet' },
  {
    kind: 'merged-branch',
    label: 'Merged branches',
    count: 'mergedBranches',
    icon: GitBranch,
    tone: 'cleanup',
  },
];

export function AttentionCenter({
  client,
  workspace,
  projects,
  refreshKey,
}: {
  client: TeamClient;
  workspace: string;
  projects: TeamPage['projects'];
  refreshKey: string;
}) {
  const [bucket, setBucket] = useState<AttentionBucket>('active'),
    [kind, setKind] = useState<AttentionKind | ''>(''),
    [project, setProject] = useState(''),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(6),
    [selected, setSelected] = useState<Set<string>>(() => new Set()),
    action = useAction(),
    state = useAttentionData(
      client,
      workspace,
      {
        bucket,
        kind: kind || undefined,
        project: project || undefined,
        query,
      },
      refreshKey,
    ),
    items = state.data?.items ?? [],
    shown = items.slice(0, limit);
  useEffect(() => {
    const visible = new Set(items.map((item) => item.id));
    setSelected((current) => new Set([...current].filter((id) => visible.has(id))));
  }, [state.data]);
  useEffect(() => {
    setLimit(6);
    setSelected(new Set());
  }, [bucket, kind, project, query]);
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );
  const decide = (choice: AttentionDecisionCommand['choice'], targets: AttentionItem[]) =>
    void action.run(async () => {
      await client.decideAttention(workspace, {
        choice,
        items: targets.map((item) => ({ id: item.id, revision: item.revision })),
      });
      setSelected(new Set());
      state.refresh();
    });
  const focused = !!(kind || project || query);
  return (
    <section className="attention-center" aria-labelledby="attention-title">
      <header className="attention-header">
        <span className="attention-orbit" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <div>
          <span className="eyebrow">START HERE</span>
          <h2 id="attention-title">The work that needs movement.</h2>
          <p>
            A small queue from current GitHub evidence. OpenBranches explains the signal; your team
            decides what happens next.
          </p>
        </div>
        <span className="attention-readonly">
          <ShieldCheck size={13} /> Read-only
        </span>
      </header>

      {state.data && (
        <div className="attention-signals" aria-label="Filter attention signals">
          {signalOptions.map(({ kind: value, label, count, icon: Icon, tone }) => (
            <button
              key={value}
              className={tone}
              aria-pressed={kind === value}
              onClick={() => setKind((current) => (current === value ? '' : value))}
            >
              <span>
                <Icon size={14} /> {label}
              </span>
              <strong>{state.data!.signals[count].toLocaleString()}</strong>
            </button>
          ))}
        </div>
      )}

      <div className="attention-controls">
        <div className="attention-buckets" aria-label="Attention queue">
          {(
            [
              ['active', 'To review'],
              ['snoozed', 'Snoozed'],
              ['dismissed', 'Dismissed'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={bucket === value} onClick={() => setBucket(value)}>
              {label} <b>{state.data?.queue[value] ?? 0}</b>
            </button>
          ))}
        </div>
        <label className="attention-search">
          <Search size={15} />
          <input
            aria-label="Search team priorities"
            placeholder="Search priorities…"
            value={query}
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon"
              aria-label="Clear priority search"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter priorities by project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="">All projects</option>
          {projects
            .filter((value) => value.githubId)
            .map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
        </select>
      </div>

      {selectedItems.length > 0 && (
        <div className="attention-selection" role="toolbar" aria-label="Selected priorities">
          <strong>{selectedItems.length.toLocaleString()} selected</strong>
          {bucket === 'active' ? (
            <>
              <button disabled={action.busy} onClick={() => decide('snoozed', selectedItems)}>
                <Clock3 size={14} /> Snooze 7 days
              </button>
              <button disabled={action.busy} onClick={() => decide('dismissed', selectedItems)}>
                <CheckCircle2 size={14} /> Dismiss
              </button>
            </>
          ) : (
            <button disabled={action.busy} onClick={() => decide('restore', selectedItems)}>
              <RotateCcw size={14} /> Restore
            </button>
          )}
          <button className="clear-selection" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {action.error && <Notice error>{action.error}</Notice>}
      {state.error && <Notice error>{state.error}</Notice>}
      {!state.data && !state.error && (
        <div className="attention-loading" role="status">
          <span /> Reading current GitHub evidence…
        </div>
      )}
      {state.data && (
        <>
          <div className="attention-caption">
            <label>
              <SelectionBox
                checked={shown.length > 0 && shown.every((item) => selected.has(item.id))}
                mixed={
                  shown.some((item) => selected.has(item.id)) &&
                  !shown.every((item) => selected.has(item.id))
                }
                disabled={!shown.length}
                onChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const item of shown) checked ? next.add(item.id) : next.delete(item.id);
                    return next;
                  })
                }
              />
              Select shown
            </label>
            <span>
              {focused ? 'Filtered evidence' : `${state.data.sources} GitHub repositories`}
              {state.data.pendingSources ? ` · ${state.data.pendingSources} preparing` : ''}
              {state.data.failedSources ? ` · ${state.data.failedSources} refresh failed` : ''} ·
              view refreshed {dateLabel(state.data.checkedAt)}
            </span>
          </div>
          {!items.length ? (
            <div className="attention-clear">
              <span>
                <Inbox size={20} />
              </span>
              <div>
                <strong>
                  {bucket === 'active'
                    ? focused
                      ? 'No priorities match this view'
                      : state.data.pendingSources
                        ? 'Priorities are still being prepared'
                        : 'Nothing needs a decision right now'
                    : `No ${bucket} priorities`}
                </strong>
                <p>
                  {focused
                    ? 'Clear a filter to widen the evidence.'
                    : state.data.pendingSources
                      ? 'The queue will fill as the selected GitHub repositories finish their first read.'
                      : 'This changes when GitHub reports a failing check, review request, quiet draft, or merged branch copy.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="attention-list">
              {shown.map((item) => (
                <AttentionRow
                  key={item.id}
                  item={item}
                  checked={selected.has(item.id)}
                  busy={action.busy}
                  onCheck={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      checked ? next.add(item.id) : next.delete(item.id);
                      return next;
                    })
                  }
                  onDecide={(choice) => decide(choice, [item])}
                />
              ))}
            </div>
          )}
          {limit < items.length && (
            <button className="attention-more" onClick={() => setLimit((value) => value + 10)}>
              Show 10 more <ChevronDown size={14} />
            </button>
          )}
          {state.data.omitted > 0 && (
            <p className="attention-omitted">
              {state.data.omitted.toLocaleString()} lower-ranked finding
              {state.data.omitted === 1 ? '' : 's'} are outside the detailed rows in this bounded
              GitHub snapshot.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function SelectionBox({
  checked,
  mixed,
  disabled,
  onChange,
}: {
  checked: boolean;
  mixed: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
    />
  );
}
