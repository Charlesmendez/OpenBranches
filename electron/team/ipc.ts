import { teamId } from '../../src/team/protocol';
import type { TeamConnections } from './connections';
import type { TeamPublisher } from './publisher';
export function registerTeamHandlers(
  handle: (channel: string, run: (...input: any[]) => unknown) => void,
  teams: TeamConnections,
  open: (url: string) => Promise<void>,
  publisher: TeamPublisher,
) {
  handle('team:sharing', () => publisher.state());
  handle('team:share-approve', (id: unknown) => publisher.approve(teamId.parse(id)));
  handle('team:share-stop', (id: unknown) => publisher.stop(teamId.parse(id)));
  handle('team:share-forget', (id: unknown) => publisher.forget(teamId.parse(id)));
  handle('team:share-refresh', () => publisher.refresh(true));
  handle('team:state', () => teams.state());
  handle('team:connect', (input: unknown) => teams.begin(input));
  handle('team:refresh', () => teams.refresh(true));
  handle('team:disconnect', (id: unknown) => teams.disconnect(teamId.parse(id)));
  handle('team:forget', (id: unknown) => teams.forget(teamId.parse(id)));
  handle('team:preview', (input: unknown) => teams.preview(input));
  handle('team:open', (id: unknown) => open(teams.browserAddress(teamId.parse(id))));
}
