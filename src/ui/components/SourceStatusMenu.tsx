import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Cloud,
  Database,
  History,
  LoaderCircle,
  Minus,
  Radio,
  Settings2,
} from 'lucide-react';
import type { GitStatus, ProviderStatus, Repository } from '../../domain/types';
import {
  workspaceSourceHealth,
  type SourceHealthId,
  type SourceHealthState,
} from '../../domain/sourceHealth';
import { relativeTime } from '../../domain/branches';
import { useClock } from '../hooks/useClock';

const sourceIcons = {
  local: Database,
  github: Cloud,
  activity: Radio,
  history: History,
} satisfies Record<SourceHealthId, typeof Database>;

const stateIcons = {
  current: Check,
  refreshing: LoaderCircle,
  delayed: CircleAlert,
  off: Minus,
} satisfies Record<SourceHealthState, typeof Check>;

export function SourceStatusMenu({
  repositories,
  providers,
  gitState,
  scanning,
  onSettings,
}: {
  repositories: Repository[];
  providers: ProviderStatus;
  gitState: GitStatus['state'];
  scanning: boolean;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const now = useClock();
  const health = workspaceSourceHealth(repositories, providers, gitState, scanning, now);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [open]);

  const SummaryIcon = stateIcons[health.state];
  return (
    <div className="source-status-menu" ref={root}>
      <button
        ref={trigger}
        className={`source-status-trigger ${health.state}`}
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={`${health.label}. Open data source status.`}
        onClick={() => setOpen((value) => !value)}
      >
        <SummaryIcon size={13} className={health.state === 'refreshing' ? 'spin' : undefined} />
        <span>{health.label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={detailsId}
          className="source-status-popover"
          role="region"
          aria-label="Data source status"
        >
          <header>
            <div>
              <strong>Data sources</strong>
              <span>What OpenBranches knows right now</span>
            </div>
          </header>
          <div className="source-status-rows">
            {health.rows.map((row) => {
              const SourceIcon = sourceIcons[row.id];
              const StateIcon = stateIcons[row.state];
              return (
                <div className={`source-status-row ${row.state}`} key={row.id}>
                  <span className="source-status-icon">
                    <SourceIcon size={15} aria-hidden="true" />
                  </span>
                  <span className="source-status-copy">
                    <strong>{row.label}</strong>
                    <small>{row.detail}</small>
                  </span>
                  <span className="source-status-value">
                    <b>
                      <StateIcon
                        size={11}
                        className={row.state === 'refreshing' ? 'spin' : undefined}
                        aria-hidden="true"
                      />
                      {row.value}
                    </b>
                    {row.checkedAt && (
                      <time
                        dateTime={row.checkedAt}
                        title={new Date(row.checkedAt).toLocaleString()}
                      >
                        {row.timeLabel ?? 'Checked'}{' '}
                        {relativeTime(row.checkedAt, now).toLowerCase()}
                      </time>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <footer>
            <span>Saved results remain visible when a source is delayed.</span>
            <button
              className="text-button"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              <Settings2 size={12} /> Manage sources
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
