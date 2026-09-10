import { CircleAlert, MessageCircleQuestion, Radio, Settings2 } from 'lucide-react';
import type { Branch, ProviderStatus } from '../../domain/types';
import { workSpotlights } from '../../domain/workSpotlight';
import { toolNames } from '../../domain/agents';
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

  const sources = activeSources(providers);
  const enabled =
    providers.codex.enabled || providers.liveAgents?.some((status) => status.enabled) === true;
  if (!providers.liveAgents && !providers.codex.enabled) return null;
  return (
    <button
      className={`project-activity-status ${sources.length ? 'watching' : enabled ? 'issue' : 'off'}`}
      title={
        sources.length
          ? `Watching for verified activity from ${sources.join(', ')}. Manage live activity.`
          : enabled
            ? 'An enabled live source is unavailable. Open Settings for details.'
            : 'Enable Claude Code or Cursor activity so the branch being worked on can glow.'
      }
      onClick={onSettings}
    >
      {sources.length ? (
        <Radio size={13} />
      ) : enabled ? (
        <CircleAlert size={13} />
      ) : (
        <Settings2 size={13} />
      )}
      <span>
        {sources.length
          ? `Watching ${sourceLabel(sources)}`
          : enabled
            ? 'Live activity unavailable'
            : 'Live activity off'}
      </span>
    </button>
  );
}

function activeSources(providers: ProviderStatus) {
  const sources = new Set<string>();
  if (
    providers.codex.enabled &&
    (providers.codex.liveState === 'connected' || providers.codex.liveState === 'partial')
  )
    sources.add(toolNames.codex);
  for (const status of providers.liveAgents ?? [])
    if (status.enabled && status.installed && status.state === 'listening')
      sources.add(toolNames[status.tool]);
  return [...sources];
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
