import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  GitBranch,
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
}: {
  item: AttentionItem;
  checked: boolean;
  busy: boolean;
  onCheck: (checked: boolean) => void;
  onDecide: (choice: AttentionDecisionCommand['choice']) => void;
}) {
  const Icon =
    item.kind === 'checks-failing'
      ? AlertTriangle
      : item.kind === 'review-requested'
        ? UserRoundCheck
        : item.kind === 'stale-draft'
          ? Clock3
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
          <span>PR #{item.pullNumber}</span>
          {item.forYou && <b>Requested from you</b>}
          {item.changed && <b>Evidence changed</b>}
        </div>
        <h3>{item.title}</h3>
        <p>{item.pullTitle}</p>
        <small>
          {item.branch} → {item.base} · {item.evidence.join(' · ')} · observed{' '}
          {dateLabel(item.observedAt)}
        </small>
      </div>
      <div className="attention-row-actions">
        <a href={item.url} target="_blank" rel="noreferrer">
          Open PR <ArrowUpRight size={13} />
        </a>
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
