import { toolNames } from './agents';
import type { ProviderStatus } from './types';

export interface LiveCoverage {
  sources: string[];
  configured: boolean;
}

/** Codex reports automatic local activity through its connection. Tool hooks
 * add direct lifecycle signals for Codex, Claude Code, and Cursor. */
export function liveCoverage(providers: ProviderStatus): LiveCoverage {
  const sources = new Set<string>();
  if (
    providers.codex.enabled &&
    (providers.codex.liveState === 'connected' || providers.codex.liveState === 'partial')
  )
    sources.add(toolNames.codex);
  for (const status of providers.liveAgents ?? [])
    if (status.enabled && status.installed && status.state === 'listening')
      sources.add(toolNames[status.tool]);

  return {
    sources: [...sources],
    configured:
      sources.size > 0 ||
      providers.codex.enabled ||
      !!providers.liveAgents?.some((status) => status.enabled),
  };
}
