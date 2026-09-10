import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '../src/domain/types';
import { connectionSummaries } from '../src/ui/settingsStatus';

const providers = (): ProviderStatus => ({
  github: { configured: true, connected: false },
  codex: { installed: true, enabled: false, state: 'not-connected' },
});

describe('settings connection summary', () => {
  it('uses explicit preview states for the demo', () => {
    expect(connectionSummaries(undefined, providers(), true).map(({ value }) => value)).toEqual([
      'Demo data',
      'Preview only',
      'Preview only',
      'Preview only',
    ]);
  });

  it('distinguishes loading and pending sources without missing values', () => {
    const status = providers();
    status.github.device = {
      code: 'ABCD-1234',
      verificationUrl: 'https://github.com/login/device',
      expiresAt: Date.now() + 60_000,
    };
    const summary = connectionSummaries(
      { state: 'checking', installAvailable: true },
      status,
      false,
    );
    expect(summary).toMatchObject([
      { value: 'Checking Git…', tone: 'waiting' },
      { value: 'Sign-in pending', tone: 'waiting' },
      { value: 'Not connected', tone: 'off' },
      { value: 'Not enabled', tone: 'off' },
    ]);
    expect(JSON.stringify(summary)).not.toContain('undefined');
  });

  it('deduplicates tools and marks only observed ready sources as ready', () => {
    const status = providers();
    status.github = { configured: true, connected: true };
    status.codex = { installed: true, enabled: true, state: 'connecting' };
    status.agents = [
      { tool: 'codex', enabled: true, state: 'ready' },
      { tool: 'claude-code', enabled: true, state: 'reading' },
    ];
    status.liveAgents = [
      {
        tool: 'codex',
        enabled: true,
        installed: true,
        state: 'listening',
        activeCount: 1,
      },
      {
        tool: 'cursor',
        enabled: true,
        installed: false,
        state: 'error',
        activeCount: 0,
      },
    ];
    expect(
      connectionSummaries({ state: 'ready', installAvailable: true }, status, false).map(
        ({ value, tone }) => [value, tone],
      ),
    ).toEqual([
      ['Git ready', 'ready'],
      ['Connected', 'ready'],
      ['2 tools enabled', 'ready'],
      ['2 tools enabled', 'ready'],
    ]);
  });
});
