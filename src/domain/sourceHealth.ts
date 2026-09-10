import { toolNames } from './agents';
import { observationStale, validObservationTime } from './sourceFreshness';
import type { GitStatus, ProviderStatus, Repository } from './types';

export type SourceHealthState = 'current' | 'refreshing' | 'delayed' | 'off';
export type SourceHealthId = 'local' | 'github' | 'activity' | 'history';

export interface SourceHealthRow {
  id: SourceHealthId;
  label: string;
  value: string;
  detail: string;
  state: SourceHealthState;
  checkedAt?: string;
  timeLabel?: 'Scanned' | 'Checked' | 'Signal';
}

export interface WorkspaceSourceHealth {
  state: Exclude<SourceHealthState, 'off'>;
  label: string;
  rows: SourceHealthRow[];
}

const LOCAL_STALE_AFTER = 2 * 60_000;
const REMOTE_STALE_AFTER = 10 * 60_000;
const HISTORY_STALE_AFTER = 5 * 60_000;
const githubRemote = /github\.com[/:]/i;

const oldest = (values: Array<string | undefined>, now: number) => {
  const times = values.flatMap((value) => {
    const time = validObservationTime(value, now);
    return time === undefined ? [] : [time];
  });
  return times.length ? new Date(Math.min(...times)).toISOString() : undefined;
};
const names = (values: string[]) =>
  values.length < 3 ? values.join(' + ') : `${values.slice(0, 2).join(', ')} +${values.length - 2}`;

function localHealth(
  repositories: Repository[],
  gitState: GitStatus['state'],
  scanning: boolean,
  now: number,
): SourceHealthRow {
  const checkedAt = oldest(
    repositories.map((repository) => repository.scannedAt),
    now,
  );
  const failed = repositories.filter((repository) => repository.error).length;
  const missingTimes = repositories.filter(
    (repository) => validObservationTime(repository.scannedAt, now) === undefined,
  ).length;
  if (gitState === 'checking')
    return {
      id: 'local',
      label: 'Local Git',
      value: 'Checking Git',
      detail: 'Checking the Git installation before local monitoring starts.',
      state: 'refreshing',
      checkedAt,
      timeLabel: 'Scanned',
    };
  if (gitState !== 'ready')
    return {
      id: 'local',
      label: 'Local Git',
      value: 'Setup needed',
      detail: 'Local inspection is paused until Git is available.',
      state: 'delayed',
      checkedAt,
      timeLabel: 'Scanned',
    };
  if (!repositories.length)
    return {
      id: 'local',
      label: 'Local Git',
      value: 'No projects',
      detail: 'Add or discover a project to begin local monitoring.',
      state: 'off',
    };
  if (scanning)
    return {
      id: 'local',
      label: 'Local Git',
      value: 'Refreshing',
      detail: `Rescanning ${repositories.length} ${repositories.length === 1 ? 'project' : 'projects'}.`,
      state: 'refreshing',
      checkedAt,
      timeLabel: 'Scanned',
    };
  if (failed || missingTimes || observationStale(checkedAt, LOCAL_STALE_AFTER, now))
    return {
      id: 'local',
      label: 'Local Git',
      value: failed ? `${failed} unavailable` : 'Update delayed',
      detail: failed
        ? `${failed} of ${repositories.length} projects could not be refreshed. Saved results remain visible.`
        : 'At least one project has not completed a recent local scan.',
      state: 'delayed',
      checkedAt,
      timeLabel: 'Scanned',
    };
  return {
    id: 'local',
    label: 'Local Git',
    value: `Watching ${repositories.length}`,
    detail: `${repositories.length} ${repositories.length === 1 ? 'repository is' : 'repositories are'} watched for local changes.`,
    state: 'current',
    checkedAt,
    timeLabel: 'Scanned',
  };
}

function githubHealth(
  repositories: Repository[],
  providers: ProviderStatus,
  now: number,
): SourceHealthRow {
  const projects = repositories.filter((repository) =>
    repository.remotes.some((remote) => githubRemote.test(remote.url)),
  );
  if (!providers.github.enabled)
    return {
      id: 'github',
      label: 'GitHub',
      value: 'Off',
      detail: projects.length
        ? 'GitHub refresh is not enabled.'
        : 'No monitored project has a GitHub remote.',
      state: 'off',
    };
  if (!projects.length)
    return {
      id: 'github',
      label: 'GitHub',
      value: 'No remotes',
      detail: 'No monitored project has a GitHub remote.',
      state: 'off',
    };
  const observed = projects.filter((repository) => repository.github);
  const checkedAt = oldest(
    observed.map((repository) => repository.github?.checkedAt),
    now,
  );
  const failed = observed.filter((repository) => repository.github?.error).length;
  const partial = observed.filter((repository) => repository.github?.partial).length;
  const missing = projects.length - observed.length;
  const access = providers.github.connected
    ? providers.github.login
      ? `Signed in as @${providers.github.login}.`
      : 'Signed in to GitHub.'
    : 'Using public GitHub access.';
  if (!observed.length)
    return {
      id: 'github',
      label: 'GitHub',
      value: providers.github.error ? 'Update delayed' : 'First check pending',
      detail: providers.github.error
        ? `${access} No repository result is available yet.`
        : `${access} Waiting for the first repository result.`,
      state: providers.github.error ? 'delayed' : 'refreshing',
    };
  if (
    providers.github.error ||
    failed ||
    partial ||
    missing ||
    observationStale(checkedAt, REMOTE_STALE_AFTER, now)
  )
    return {
      id: 'github',
      label: 'GitHub',
      value: failed || providers.github.error ? 'Update delayed' : 'Partial results',
      detail: `${access} ${failed ? `${failed} failed. ` : ''}${partial ? `${partial} partial. ` : ''}${missing ? `${missing} awaiting data. ` : ''}Last good results remain visible.`,
      state: 'delayed',
      checkedAt,
      timeLabel: 'Checked',
    };
  return {
    id: 'github',
    label: 'GitHub',
    value: `Current for ${projects.length}`,
    detail: `${access} Branches and pull requests refresh automatically.`,
    state: 'current',
    checkedAt,
    timeLabel: 'Checked',
  };
}

function liveHealth(providers: ProviderStatus, now: number): SourceHealthRow {
  const enabled = (providers.liveAgents ?? []).filter((status) => status.enabled);
  if (!providers.codex.enabled && !enabled.length)
    return {
      id: 'activity',
      label: 'Live activity',
      value: 'Off',
      detail: 'Connect Codex or enable a Claude Code or Cursor listener.',
      state: 'off',
    };
  const listening = enabled.filter((status) => status.installed && status.state === 'listening');
  const codexCurrent =
    providers.codex.enabled &&
    (providers.codex.liveState === 'connected' || providers.codex.liveState === 'partial');
  const codexHookCurrent = listening.some((status) => status.tool === 'codex');
  const sources = new Set([
    ...(codexCurrent ? [toolNames.codex] : []),
    ...listening.map((status) => toolNames[status.tool]),
  ]);
  const active = listening
    .filter((status) => status.tool !== 'codex' || !codexCurrent)
    .reduce((sum, status) => sum + status.activeCount, 0);
  const problems = [
    ...enabled
      .filter((status) => !status.installed || status.state !== 'listening')
      .map((status) => toolNames[status.tool]),
    ...(providers.codex.enabled && !codexCurrent && !codexHookCurrent ? [toolNames.codex] : []),
  ];
  const checkedAt = oldest(
    [
      ...(codexCurrent ? [providers.codex.liveCheckedAt] : []),
      ...listening.map((status) => status.receivedAt),
    ],
    now,
  );
  if (problems.length)
    return {
      id: 'activity',
      label: 'Live activity',
      value: `${problems.length} need setup`,
      detail: `${sources.size ? `${names([...sources])} ${sources.size === 1 ? 'is' : 'are'} watching. ` : ''}${names(problems)} ${problems.length === 1 ? 'is' : 'are'} unavailable.`,
      state: 'delayed',
      checkedAt,
      timeLabel: 'Signal',
    };
  return {
    id: 'activity',
    label: 'Live activity',
    value: active ? `${active} live` : 'Listening',
    detail: `${names([...sources])} ${sources.size === 1 ? 'is' : 'are'} watching on this Mac.`,
    state: providers.codex.liveState === 'partial' ? 'delayed' : 'current',
    checkedAt,
    timeLabel: 'Signal',
  };
}

function historyHealth(providers: ProviderStatus, now: number): SourceHealthRow {
  const sources = [
    ...(providers.codex.enabled
      ? [
          {
            name: toolNames.codex,
            state: providers.codex.state,
            checkedAt: providers.codex.checkedAt,
            partial: providers.codex.partial,
          },
        ]
      : []),
    ...(providers.agents ?? [])
      .filter((status) => status.enabled)
      .map((status) => ({
        name: toolNames[status.tool],
        state: status.state,
        checkedAt: status.checkedAt,
        partial: status.partial,
      })),
  ];
  if (!sources.length)
    return {
      id: 'history',
      label: 'Task history',
      value: 'Off',
      detail: 'Saved coding-tool task and session history is optional.',
      state: 'off',
    };
  const checkedAt = oldest(
    sources.map((source) => source.checkedAt),
    now,
  );
  const reading = sources.some(
    (source) => source.state === 'connecting' || source.state === 'reading',
  );
  const failed = sources.some(
    (source) =>
      source.partial ||
      source.state === 'error' ||
      source.state === 'unavailable' ||
      source.state === 'not-connected',
  );
  if (failed || (!reading && observationStale(checkedAt, HISTORY_STALE_AFTER, now)))
    return {
      id: 'history',
      label: 'Task history',
      value: 'Partial results',
      detail: `${names(sources.map((source) => source.name))} history is incomplete or delayed.`,
      state: 'delayed',
      checkedAt,
      timeLabel: 'Checked',
    };
  if (reading)
    return {
      id: 'history',
      label: 'Task history',
      value: 'Refreshing',
      detail: `Reading saved metadata from ${names(sources.map((source) => source.name))}.`,
      state: 'refreshing',
      checkedAt,
      timeLabel: 'Checked',
    };
  return {
    id: 'history',
    label: 'Task history',
    value: 'Current',
    detail: `Saved metadata from ${names(sources.map((source) => source.name))} is available.`,
    state: 'current',
    checkedAt,
    timeLabel: 'Checked',
  };
}

export function workspaceSourceHealth(
  repositories: Repository[],
  providers: ProviderStatus,
  gitState: GitStatus['state'],
  scanning: boolean,
  now = Date.now(),
): WorkspaceSourceHealth {
  const rows = [
    localHealth(repositories, gitState, scanning, now),
    githubHealth(repositories, providers, now),
    liveHealth(providers, now),
    historyHealth(providers, now),
  ];
  const delayed = rows.filter((row) => row.state === 'delayed').length;
  const refreshing = rows.some((row) => row.state === 'refreshing');
  const enabled = rows.some((row) => row.state !== 'off');
  return {
    state: delayed ? 'delayed' : refreshing ? 'refreshing' : 'current',
    label: delayed
      ? `${delayed} ${delayed === 1 ? 'source needs' : 'sources need'} attention`
      : refreshing
        ? 'Refreshing sources'
        : enabled
          ? 'Sources current'
          : 'Sources ready',
    rows,
  };
}
