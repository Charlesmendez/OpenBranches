import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { workspaceSourceHealth } from '../src/domain/sourceHealth';
import type { ProviderStatus } from '../src/domain/types';

const now = Date.parse('2026-09-09T20:00:00Z');
const at = new Date(now).toISOString();
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString();

function providers(extra: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    github: { connected: false, configured: false, enabled: false },
    codex: { installed: true, enabled: false, state: 'not-connected' },
    liveAgents: [],
    agents: [],
    ...extra,
  };
}

describe('workspace source health', () => {
  it('calls an empty workspace ready instead of implying that disabled sources refreshed', () => {
    expect(workspaceSourceHealth([], providers(), 'ready', false, now)).toMatchObject({
      state: 'current',
      label: 'Sources ready',
    });
  });

  it('summarizes current local, GitHub, live, and history observations independently', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = at;
    repository.github = { checkedAt: at, partial: false };
    const status = providers({
      github: { connected: true, configured: true, enabled: true, login: 'fixture-user' },
      codex: {
        installed: true,
        enabled: true,
        state: 'ready',
        checkedAt: at,
        taskCount: 3,
      },
      liveAgents: [
        {
          tool: 'codex',
          enabled: true,
          installed: true,
          state: 'listening',
          activeCount: 1,
          receivedAt: at,
        },
      ],
    });
    const health = workspaceSourceHealth([repository], status, 'ready', false, now);
    expect(health.label).toBe('Sources current');
    expect(health.rows.map((row) => [row.id, row.state, row.value])).toEqual([
      ['local', 'current', 'Watching 1'],
      ['github', 'current', 'Current for 1'],
      ['activity', 'current', '1 live'],
      ['history', 'current', 'Current'],
    ]);
    expect(health.rows.find((row) => row.id === 'activity')?.timeLabel).toBe('Signal');
  });

  it('treats the connected Codex activity reader as live coverage without a separate hook', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = at;
    const health = workspaceSourceHealth(
      [repository],
      providers({
        codex: {
          installed: true,
          enabled: true,
          state: 'ready',
          checkedAt: at,
          liveState: 'connected',
          liveCheckedAt: at,
        },
      }),
      'ready',
      false,
      now,
    );
    expect(health.rows.find((row) => row.id === 'activity')).toMatchObject({
      state: 'current',
      value: 'Listening',
      detail: 'Codex is watching on this Mac.',
    });
  });

  it('reports delayed local and remote evidence while preserving their observation times', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = ago(3 * 60_000);
    repository.github = { checkedAt: ago(11 * 60_000), partial: false };
    const health = workspaceSourceHealth(
      [repository],
      providers({ github: { connected: false, configured: false, enabled: true } }),
      'ready',
      false,
      now,
    );
    expect(health).toMatchObject({ state: 'delayed', label: '2 sources need attention' });
    expect(health.rows.find((row) => row.id === 'local')).toMatchObject({
      state: 'delayed',
      checkedAt: ago(3 * 60_000),
    });
    expect(health.rows.find((row) => row.id === 'github')).toMatchObject({
      state: 'delayed',
      checkedAt: ago(11 * 60_000),
    });
  });

  it('distinguishes an active refresh from failures and optional sources that are off', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = ago(20 * 60_000);
    const health = workspaceSourceHealth([repository], providers(), 'ready', true, now);
    expect(health).toMatchObject({ state: 'refreshing', label: 'Refreshing sources' });
    expect(health.rows.map((row) => [row.id, row.state])).toEqual([
      ['local', 'refreshing'],
      ['github', 'off'],
      ['activity', 'off'],
      ['history', 'off'],
    ]);
  });

  it('does not call a failed first GitHub check refreshing', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = at;
    repository.github = undefined;
    const health = workspaceSourceHealth(
      [repository],
      providers({
        github: {
          connected: false,
          configured: false,
          enabled: true,
          error: 'Rate limited',
        },
      }),
      'ready',
      false,
      now,
    );
    const github = health.rows.find((row) => row.id === 'github');
    expect(github).toMatchObject({
      state: 'delayed',
      value: 'Update delayed',
    });
    expect(github?.checkedAt).toBeUndefined();
  });

  it('surfaces partial history and live listeners that need repair', () => {
    const repository = createDemoSnapshot(now).repositories[0];
    repository.scannedAt = at;
    const health = workspaceSourceHealth(
      [repository],
      providers({
        agents: [
          {
            tool: 'claude-code',
            enabled: true,
            state: 'ready',
            checkedAt: at,
            partial: true,
          },
        ],
        liveAgents: [
          {
            tool: 'cursor',
            enabled: true,
            installed: false,
            state: 'error',
            activeCount: 0,
          },
        ],
      }),
      'ready',
      false,
      now,
    );
    expect(health.label).toBe('2 sources need attention');
    expect(health.rows.find((row) => row.id === 'activity')?.value).toBe('1 need setup');
    expect(health.rows.find((row) => row.id === 'history')?.value).toBe('Partial results');
  });
});
