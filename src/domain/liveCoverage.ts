import { toolNames } from './agents';
import type { ProviderStatus } from './types';

export interface LiveCoverage {
  sources: string[];
  configured: boolean;
}

/** Task-history indexing and live detection are separate connections. Modern
 * clients report hook status explicitly; the Codex flag is only a legacy
 * fallback when that status has not loaded yet. */
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
    configured: providers.liveAgents
      ? providers.liveAgents.some((status) => status.enabled)
      : providers.codex.enabled,
  };
}
