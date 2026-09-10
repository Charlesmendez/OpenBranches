import type { TeamClient, TeamFilter } from './client';
import type { GitHubWorkPage } from './github';

export interface LoadedGitHubWork extends GitHubWorkPage {
  limitReached: boolean;
}

/** GitHub pages are combined only while their permission and snapshot revision
 * matches. The aggregate stays bounded even when a workspace has many repos. */
export async function loadGitHubWork(
  client: Pick<TeamClient, 'githubWork'>,
  workspace: string,
  filter: TeamFilter,
  pages: number,
  signal: AbortSignal,
): Promise<LoadedGitHubWork> {
  const wanted = Math.max(1, Math.min(10, Math.floor(pages)));
  for (let attempt = 0; attempt < 2; attempt++) {
    let collected = await client.githubWork(workspace, filter, signal),
      consistent = true;
    let bytes = new TextEncoder().encode(JSON.stringify(collected)).byteLength;
    for (let page = 1; page < wanted && collected.nextCursor; page++) {
      signal.throwIfAborted();
      const next = await client.githubWork(
        workspace,
        { ...filter, cursor: collected.nextCursor },
        signal,
      );
      if (next.revision !== collected.revision) {
        consistent = false;
        break;
      }
      const size = new TextEncoder().encode(JSON.stringify(next)).byteLength;
      if (bytes + size > 16_000_000) return { ...collected, limitReached: true };
      bytes += size;
      collected = { ...next, sources: [...collected.sources, ...next.sources] };
    }
    if (consistent) return { ...collected, limitReached: false };
  }
  throw new Error('GitHub work changed while loading. Refresh or narrow the project.');
}
