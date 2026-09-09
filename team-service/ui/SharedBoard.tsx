import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Laptop,
  Layers,
  X,
  Clock,
  Check,
  Minus,
} from 'lucide-react';
import type { SharedWork, SharedSnapshot } from '../../src/team/protocol';
import { sharedWorkStale } from '../../src/team/protocol';
import type { TeamPage } from '../../src/team/responses';
import { ToolIcon, ReportedModel } from '../../src/ui/components/AgentBadges';
import { toolNames } from '../../src/domain/agents';
import { Avatar, dateLabel, Empty, Notice } from './primitives';
type Branch = SharedSnapshot['branches'][number];
interface Row {
  work: SharedWork;
  branch: Branch;
  person: string;
  project: string;
  key: string;
}
export function SharedBoard({
  data,
  group,
  now,
  focused = false,
}: {
  data: TeamPage;
  group: 'person' | 'project';
  now: number;
  focused?: boolean;
}) {
  const [selection, setSelection] = useState<string>();
  const detail = useRef<HTMLElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const choose = (key: string) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection(key);
  };
  const close = () => {
    setSelection(undefined);
    opener.current?.focus();
  };
  useEffect(() => {
    if (!selection) return;
    detail.current?.focus({ preventScroll: true });
    if (matchMedia('(max-width: 900px)').matches)
      detail.current?.scrollIntoView({ block: 'start' });
  }, [selection]);
  const rows = useMemo(
    () =>
      data.work.flatMap((work) =>
        work.snapshot.branches.map((branch) => ({
          work,
          branch,
          person:
            data.people.find((person) => person.id === work.memberId)?.login ??
            'Member outside this page',
          project:
            data.projects.find((project) => project.id === work.projectId)?.name ??
            'Project outside this page',
          key: work.deviceId + ':' + work.projectId + ':' + branch.key,
        })),
      ),
    [data],
  );
  const groups = useMemo(() => {
    const groups = new Map<string, { name: string; rows: Row[] }>();
    for (const row of rows) {
      const key = group === 'person' ? row.work.memberId : row.work.projectId;
      const current = groups.get(key) ?? {
        name: group === 'person' ? row.person : row.project,
        rows: [],
      };
      current.rows.push(row);
      groups.set(key, current);
    }
    return [...groups].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows, group]);
  const selected = rows.find((row) => row.key === selection);
  return (
    <div className={'shared-layout' + (selected ? ' has-detail' : '')}>
      <div className="shared-groups">
        {!groups.length && (
          <Empty title={focused ? 'No shared branches match this view' : 'No shared branches yet'}>
            {focused
              ? 'Try another person, project, or search. Only metadata that members choose to share appears here.'
              : 'Connect a Mac and choose projects to share. Their branch reports will appear here, grouped by person or project.'}
          </Empty>
        )}
        {groups.map(([key, value]) => (
          <BranchGroup
            key={group + key + String(focused)}
            initiallyOpen={focused}
            name={value.name}
            rows={value.rows}
            group={group}
            now={now}
            selected={selection}
            onSelect={choose}
          />
        ))}
      </div>
      {selected && (
        <aside
          ref={detail}
          tabIndex={-1}
          className="shared-detail"
          aria-label="Shared branch details"
        >
          <header>
            <span className="eyebrow">SHARED BRANCH</span>
            <button className="icon" aria-label="Close branch details" onClick={close}>
              <X size={18} />
            </button>
          </header>
          <GitBranch size={24} className="accent" />
          <h2>{selected.branch.name}</h2>
          <p className="detail-origin">
            {selected.project} · reported by @{selected.person}
          </p>
          <div className="detail-status">
            <Laptop size={15} />
            {selected.work.deviceName}
            <span className={'freshness ' + (sharedWorkStale(selected.work, now) ? 'stale' : '')}>
              {sharedWorkStale(selected.work, now) ? 'Outdated snapshot' : 'Recent snapshot'}
            </span>
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Observed on device</dt>
              <dd>{dateLabel(selected.work.snapshot.observedAt)}</dd>
            </div>
            <div>
              <dt>Received by team</dt>
              <dd>{dateLabel(selected.work.receivedAt)}</dd>
            </div>
            <div>
              <dt>Local commit</dt>
              <dd>
                <code>{selected.branch.localSha?.slice(0, 12) ?? 'Unknown'}</code>
              </dd>
            </div>
            <div>
              <dt>Working copies</dt>
              <dd>
                {selected.branch.worktrees.available} available of {selected.branch.worktrees.total}
              </dd>
            </div>
            <div>
              <dt>Changed files</dt>
              <dd>{selected.branch.worktrees.changedFiles ?? 'Unknown'}</dd>
            </div>
          </dl>
          <section>
            <h3>Integration history</h3>
            {!selected.branch.integration.length ? (
              <p className="muted">No target history was reported.</p>
            ) : (
              selected.branch.integration.map((target) => (
                <div className="target-row" key={target.name}>
                  <span className="target-name">
                    <GitBranch size={13} />
                    {target.name}
                  </span>
                  <span className={'history ' + target.state}>
                    {target.state === 'integrated' ? (
                      <Check size={13} />
                    ) : target.state === 'pending' ? (
                      <Minus size={13} />
                    ) : (
                      <Clock size={13} />
                    )}{' '}
                    {target.state === 'integrated'
                      ? 'In history'
                      : target.state === 'pending'
                        ? 'Not in history'
                        : 'Unknown'}
                  </span>
                </div>
              ))
            )}
            <p className="microcopy">
              Commit ancestry alone cannot identify equivalent squash merges.
            </p>
          </section>
          <section>
            <h3>Recorded coding sessions</h3>
            {!selected.branch.tasks.length ? (
              <p className="muted">No coding tool was reported for this branch.</p>
            ) : (
              selected.branch.tasks.map((task) => (
                <div className="shared-task" key={task.key}>
                  <strong>
                    <ToolIcon tool={task.tool} />
                    {toolNames[task.tool]}
                  </strong>
                  <small>
                    {task.association === 'verified'
                      ? 'Branch and commit match'
                      : 'Possible association'}{' '}
                    · {dateLabel(task.checkedAt)}
                  </small>
                  {task.model && <ReportedModel model={task.model} />}{' '}
                  {task.title && <p>{task.title}</p>}
                  {task.summary && <p className="muted">{task.summary}</p>}
                </div>
              ))
            )}
            {!!selected.branch.omittedTasks && (
              <Notice>
                {selected.branch.omittedTasks} additional sessions were omitted by the device.
              </Notice>
            )}
          </section>
          <p className="microcopy">
            This is metadata reported by an opted-in device. It does not establish who authored
            every change or whether a person is working right now.
          </p>
        </aside>
      )}
    </div>
  );
}
function BranchGroup({
  name,
  rows,
  group,
  now,
  selected,
  onSelect,
  initiallyOpen,
}: {
  initiallyOpen: boolean;
  name: string;
  rows: Row[];
  group: 'person' | 'project';
  now: number;
  selected?: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen),
    [limit, setLimit] = useState(8);
  const outdated = new Set(
    rows
      .filter((row) => sharedWorkStale(row.work, now))
      .map((row) => row.work.deviceId + row.work.projectId),
  ).size;
  return (
    <section className="branch-group">
      <button
        className="group-heading"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {group === 'person' ? (
          <Avatar name={name} />
        ) : (
          <span className="project-symbol">
            <Layers size={19} />
          </span>
        )}
        <span>
          <strong>
            {group === 'person' ? '@' : ''}
            {name}
          </strong>
          <small>
            {
              new Set(
                rows.map((row) => (group === 'person' ? row.work.projectId : row.work.memberId)),
              ).size
            }{' '}
            {group === 'person'
              ? new Set(rows.map((row) => row.work.projectId)).size === 1
                ? 'project'
                : 'projects'
              : new Set(rows.map((row) => row.work.memberId)).size === 1
                ? 'person'
                : 'people'}{' '}
            · {rows.length} loaded branch reports
          </small>
        </span>
        <span className="group-tools">
          {[...new Set(rows.flatMap((row) => row.branch.tasks.map((task) => task.tool)))]
            .slice(0, 3)
            .map((tool) => (
              <span key={tool} aria-label={toolNames[tool]} title={toolNames[tool]}>
                <ToolIcon tool={tool} />
              </span>
            ))}
        </span>
        {outdated > 0 && (
          <em>
            {outdated} outdated {outdated === 1 ? 'snapshot' : 'snapshots'}
          </em>
        )}
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="branch-group-body">
          {rows.slice(0, limit).map((row) => (
            <button
              key={row.key}
              className={'shared-branch-row' + (selected === row.key ? ' selected' : '')}
              onClick={() => onSelect(row.key)}
            >
              <span className="branch-node">
                <GitBranch size={15} />
              </span>
              <span className="branch-label">
                <strong>{row.branch.name}</strong>
                <small>
                  {group === 'person' ? row.project : '@' + row.person} · {row.work.deviceName}
                </small>
              </span>
              <span className="branch-tools">
                {[...new Set(row.branch.tasks.map((task) => task.tool))].slice(0, 3).map((tool) => (
                  <span key={tool} title={toolNames[tool]} aria-label={toolNames[tool]}>
                    <ToolIcon tool={tool} />
                  </span>
                ))}
              </span>
              <span
                className={
                  'row-state ' +
                  (sharedWorkStale(row.work, now)
                    ? 'stale'
                    : row.branch.worktrees.dirty
                      ? 'dirty'
                      : '')
                }
              >
                {sharedWorkStale(row.work, now)
                  ? 'Outdated'
                  : row.branch.worktrees.dirty === null
                    ? 'Status unknown'
                    : row.branch.worktrees.dirty
                      ? 'Uncommitted work'
                      : 'Snapshot saved'}
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {rows.length > limit && (
            <button className="more-branches" onClick={() => setLimit((value) => value + 20)}>
              Show {Math.min(20, rows.length - limit)} more branches <ChevronDown size={14} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
