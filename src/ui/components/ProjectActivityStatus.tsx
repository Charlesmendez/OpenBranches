import { CircleAlert, MessageCircleQuestion, Radio, Settings2 } from 'lucide-react';
import type { Branch, ProviderStatus } from '../../domain/types';
import { workSpotlights } from '../../domain/workSpotlight';
import { liveCoverage } from '../../domain/liveCoverage';
import { useClock } from '../hooks/useClock';

export function ProjectActivityStatus({
  branches,
  repositoryPath,
  providers,
  showCurrent,
  onFocus,
  onSettings,
}: {
  branches: Branch[];
  repositoryPath: string;
  providers: ProviderStatus;
  showCurrent: boolean;
  onFocus: (branch: Branch) => void;
  onSettings: () => void;
}) {
  const now = useClock();
  const current = workSpotlights(branches, repositoryPath, now).filter(
    ({ signal }) => signal.kind === 'live' || signal.kind === 'waiting',
  );
  const live = current.filter(({ signal }) => signal.kind === 'live').length;
  const waiting = current.length - live;
  if (current.length) {
    if (!showCurrent) return null;
    const first = current[0];
    return (
      <button
        className={`project-activity-status ${live ? 'live' : 'waiting'}`}
        title={`Focus ${first.branch.name} — ${first.signal.label}`}
        onClick={() => onFocus(first.branch)}
      >
        {live ? <Radio size={13} /> : <MessageCircleQuestion size={13} />}
        <span>{activityLabel(live, waiting)}</span>
      </button>
    );
  }

  const { sources, configured } = liveCoverage(providers);
  if (!providers.liveAgents && !providers.codex.enabled) return null;
  const taskHistoryConnected = providers.codex.enabled;
  return (
    <button
      className={`project-activity-status ${sources.length ? 'watching' : configured ? 'issue' : 'off'}`}
      title={
        sources.length
          ? `Watching for verified activity from ${sources.join(', ')}. Manage live activity.`
          : configured
            ? 'An enabled live source is unavailable. Open Settings for details.'
            : taskHistoryConnected
              ? 'Codex is connected, but its local live activity source is unavailable. Open Settings for details.'
              : 'Enable Codex, Claude Code, or Cursor live activity so the exact branch can glow while work runs.'
      }
      onClick={onSettings}
    >
      {sources.length ? (
        <Radio size={13} />
      ) : configured ? (
        <CircleAlert size={13} />
      ) : (
        <Settings2 size={13} />
      )}
      <span>
        {sources.length
          ? `Watching ${sourceLabel(sources)}`
          : configured
            ? 'Live activity unavailable'
            : 'Enable live branch glow'}
      </span>
    </button>
  );
}

function activityLabel(live: number, waiting: number) {
  const parts: string[] = [];
  if (live) parts.push(`${live} ${live === 1 ? 'branch' : 'branches'} live`);
  if (waiting) parts.push(`${waiting} waiting`);
  return parts.join(' · ');
}

function sourceLabel(sources: string[]) {
  if (sources.length === 1) return sources[0];
  if (sources.length === 2) return `${sources[0]} + ${sources[1]}`;
  return `${sources.length} tools`;
}
