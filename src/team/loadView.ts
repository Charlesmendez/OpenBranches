import type { TeamClient, TeamFilter } from './client';
import type { TeamPage } from './responses';
export interface LoadedTeamView extends TeamPage {
  limitReached: boolean;
}
/** Pages must describe one revision. Never stitch observations from different
 * permission/snapshot versions together, and keep the loaded metadata bounded. */
export async function loadTeamView(
  client: Pick<TeamClient, 'view'>,
  workspace: string,
  filter: TeamFilter,
  pages: number,
  signal: AbortSignal,
): Promise<LoadedTeamView> {
  const wanted = Math.max(1, Math.min(10, Math.floor(pages)));
  for (let attempt = 0; attempt < 2; attempt++) {
    let collected = await client.view(workspace, filter, signal),
      consistent = true;
    let bytes = new TextEncoder().encode(JSON.stringify(collected)).byteLength;
    for (let page = 1; page < wanted && collected.nextCursor; page++) {
      signal.throwIfAborted();
      const next = await client.view(
        workspace,
        { ...filter, cursor: collected.nextCursor },
        signal,
      );
      if (next.workspace.revision !== collected.workspace.revision) {
        consistent = false;
        break;
      }
      const size = new TextEncoder().encode(JSON.stringify(next)).byteLength;
      if (bytes + size > 16_000_000) return { ...collected, limitReached: true };
      bytes += size;
      collected = { ...next, work: [...collected.work, ...next.work] };
    }
    if (consistent) return { ...collected, limitReached: false };
  }
  throw new Error('Shared work changed while loading. Refresh or narrow the person or project.');
}
