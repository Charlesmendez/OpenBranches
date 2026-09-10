import {
  AlertTriangle,
  ArrowUpRight,
  CloudOff,
  Clock3,
  GitBranch,
  History,
  RotateCcw,
  UserRoundCheck,
} from 'lucide-react';
import type { AttentionDecisionCommand, AttentionItem } from '../../src/team/attention';
import { dateLabel } from './primitives';

export function AttentionRow({
  item,
  checked,
  busy,
  onCheck,
  onDecide,
  onOpenLocal,
}: {
  item: AttentionItem;
  checked: boolean;
  busy: boolean;
  onCheck: (checked: boolean) => void;
  onDecide: (choice: AttentionDecisionCommand['choice']) => void;
  onOpenLocal: (item: Extract<AttentionItem, { source: 'local' }>) => void;
}) {
  const Icon =
    item.kind === 'checks-failing'
      ? AlertTriangle
      : item.kind === 'review-requested'
        ? UserRoundCheck
        : item.kind === 'stale-draft'
          ? Clock3
          : item.kind === 'local-only'
            ? CloudOff
            : item.kind === 'forgotten-work'
              ? History
              : GitBranch;
  return (
    <article className={`attention-row ${item.priority}${item.forYou ? ' for-you' : ''}`}>
      <label className="attention-row-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
          aria-label={`Select ${item.title}`}
        />
      </label>
      <span className="attention-row-icon">
        <Icon size={16} />
      </span>
      <div className="attention-row-copy">
        <div className="attention-row-meta">
          <span>{item.project}</span>
          <span>{item.source === 'github' ? `PR #${item.pullNumber}` : `@${item.person}`}</span>
          {item.forYou && <b>{item.source === 'github' ? 'Requested from you' : 'Your Mac'}</b>}
          {item.changed && <b>Evidence changed</b>}
        </div>
        <h3>{item.title}</h3>
        <p>{item.source === 'github' ? item.pullTitle : `${item.device} · ${item.branch}`}</p>
        <small>
          {item.source === 'github' && `${item.branch} → ${item.base} · `}
          {item.evidence.join(' · ')} · observed {dateLabel(item.observedAt)}
        </small>
      </div>
      <div className="attention-row-actions">
        {item.source === 'github' ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            Open PR <ArrowUpRight size={13} />
          </a>
        ) : (
          <button className="open-local" onClick={() => onOpenLocal(item)}>
            View branch <ArrowUpRight size={13} />
          </button>
        )}
        {item.state === 'active' ? (
          <>
            <button disabled={busy} onClick={() => onDecide('snoozed')}>
              Snooze
            </button>
            <button disabled={busy} onClick={() => onDecide('dismissed')}>
              Dismiss
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => onDecide('restore')}>
            <RotateCcw size={13} /> Restore
          </button>
        )}
      </div>
    </article>
  );
}
