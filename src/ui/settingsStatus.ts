import type { GitStatus, ProviderStatus } from '../domain/types';

export type ConnectionSummaryId = 'mac' | 'github' | 'history' | 'live';
export interface ConnectionSummaryItem {
  id: ConnectionSummaryId;
  label: string;
  value: string;
  tone: 'ready' | 'waiting' | 'off';
}

export function connectionSummaries(
  git: GitStatus | undefined,
  providers: ProviderStatus,
  demo: boolean,
): ConnectionSummaryItem[] {
  if (demo)
    return [
      { id: 'mac', label: 'This Mac', value: 'Demo data', tone: 'ready' },
      { id: 'github', label: 'GitHub', value: 'Preview only', tone: 'ready' },
      { id: 'history', label: 'Task history', value: 'Preview only', tone: 'ready' },
      { id: 'live', label: 'Live activity', value: 'Preview only', tone: 'ready' },
    ];

  const saved = new Map<string, 'ready' | 'waiting'>();
  if (providers.codex.enabled)
    saved.set('codex', providers.codex.state === 'ready' ? 'ready' : 'waiting');
  for (const status of providers.agents ?? [])
    if (status.enabled)
      saved.set(
        status.tool,
        status.state === 'ready' ? 'ready' : (saved.get(status.tool) ?? 'waiting'),
      );
  const live = (providers.liveAgents ?? []).filter((status) => status.enabled);
  const enabled = (count: number) => `${count} ${count === 1 ? 'tool' : 'tools'} enabled`;

  return [
    {
      id: 'mac',
      label: 'This Mac',
      value:
        !git || git.state === 'checking'
          ? 'Checking Git…'
          : git.state === 'ready'
            ? git.version
              ? `Git ${git.version}`
              : 'Git ready'
            : git.state === 'unavailable'
              ? 'Unavailable'
              : 'Setup needed',
      tone: !git || git.state === 'checking' ? 'waiting' : git.state === 'ready' ? 'ready' : 'off',
    },
    {
      id: 'github',
      label: 'GitHub',
      value: providers.github.device
        ? 'Sign-in pending'
        : providers.github.connected
          ? providers.github.login
            ? `@${providers.github.login}`
            : 'Connected'
          : providers.github.enabled
            ? 'Public projects'
            : 'Not connected',
      tone: providers.github.device
        ? 'waiting'
        : providers.github.connected || providers.github.enabled
          ? 'ready'
          : 'off',
    },
    {
      id: 'history',
      label: 'Task history',
      value: saved.size ? enabled(saved.size) : 'Not connected',
      tone: [...saved.values()].includes('ready') ? 'ready' : saved.size ? 'waiting' : 'off',
    },
    {
      id: 'live',
      label: 'Live activity',
      value: live.length ? enabled(live.length) : 'Not enabled',
      tone: live.some(({ state }) => state === 'listening')
        ? 'ready'
        : live.length
          ? 'waiting'
          : 'off',
    },
  ];
}
