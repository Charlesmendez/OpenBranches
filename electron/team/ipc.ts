import { teamId } from '../../src/team/protocol';
import type { TeamConnections } from './connections';
export function registerTeamHandlers(
  handle: (channel: string, run: (...input: any[]) => unknown) => void,
  teams: TeamConnections,
  open: (url: string) => Promise<void>,
) {
  handle('team:state', () => teams.state());
  handle('team:connect', (input: unknown) => teams.begin(input));
  handle('team:refresh', () => teams.refresh(true));
  handle('team:disconnect', (id: unknown) => teams.disconnect(teamId.parse(id)));
  handle('team:forget', (id: unknown) => teams.forget(teamId.parse(id)));
  handle('team:preview', (input: unknown) => teams.preview(input));
  handle('team:open', (id: unknown) => open(teams.browserAddress(teamId.parse(id))));
}
