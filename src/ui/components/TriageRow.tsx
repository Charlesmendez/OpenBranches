import { ArrowUpRight, Pause, RotateCcw } from 'lucide-react';
import type { Branch, ReviewCommand } from '../../domain/types';
import type { ReviewBucket } from '../../domain/reviews';
import { triageQueues, type TriageItem } from '../../domain/triage';
import { relativeTime } from '../../domain/branches';

export function TriageRow({
  item,
  branch,
  projectName,
  now,
  selected,
  busy,
  bucket,
  onSelection,
  onInspect,
  onChoose,
}: {
  item: TriageItem;
  branch?: Branch;
  projectName?: string;
  now: number;
  selected: boolean;
  busy: boolean;
  bucket: ReviewBucket;
  onSelection: (selected: boolean) => void;
  onInspect: () => void;
  onChoose: (choice: ReviewCommand['choice']) => Promise<unknown>;
}) {
  return (
    <article
      className="triage-row"

      aria-label={`Review ${branch?.name ?? 'branch'}`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${branch?.name ?? 'branch'}`}
        checked={selected}
        onChange={(event) => onSelection(event.target.checked)}
      />
      <div className="triage-row-main">
        <div className="triage-row-context">
          <span>{projectName}</span>
          <span>Last commit {relativeTime(branch?.updatedAt ?? '', now)}</span>
        </div>
        <button className="triage-branch-name" onClick={() => onInspect()}>
          {branch?.title ?? branch?.name ?? 'Branch'}
          <ArrowUpRight size={13} />
        </button>
        <code>{branch?.name}</code>
        <details>
          <summary>
            {triageQueues[item.queue].title}
            {item.findings.length > 1 ? ` · ${item.findings.length} signals` : ''}
          </summary>
          {item.findings.map(({ finding, changed }) => (
            <div key={finding.id} className="triage-evidence">
              {changed && <strong>Evidence changed since your last review</strong>}
              <p>{finding.explanation}</p>
              <ul>
                {finding.evidence.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <small>Evidence checked {relativeTime(finding.checkedAt, now)}</small>
            </div>
          ))}
        </details>
      </div>
      <div className="triage-row-actions">
        {bucket === 'active' ? (
          <>
            <button
              disabled={busy}
              title="Snooze all signals for this branch for seven days"
              onClick={() => void onChoose('snoozed')}
            >
              <Pause size={13} />
              Snooze
            </button>
            <button disabled={busy} onClick={() => void onChoose('dismissed')}>
              Dismiss
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => void onChoose('restore')}>
            <RotateCcw size={13} />
            Restore
          </button>
        )}
      </div>
    </article>
  );
}
