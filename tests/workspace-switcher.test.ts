import { describe, expect, it } from 'vitest';
import type { TeamConnectionStatus } from '../src/team/device';
import { workspaceConnections } from '../src/ui/workspaceDestinations';

const connection = (
  id: string,
  origin: string,
  state: TeamConnectionStatus['state'],
  workspaceId?: string,
): TeamConnectionStatus => ({
  id,
  origin,
  state,
  deviceName: 'Fixture Mac',
  identity: workspaceId
    ? {
        deviceId: `${id}-device`,
        workspaceId,
        memberId: `${id}-member`,
        deviceName: 'Fixture Mac',
        workspaceName: id,
        login: 'member',
        expiresAt: '2027-09-09T00:00:00.000Z',
      }
    : undefined,
});

describe('workspace destinations', () => {
  it('shows each team once and prefers a connected destination', () => {
    const destinations = workspaceConnections([
      connection('old attempt', 'https://atlas.test', 'unavailable'),
      connection('Relay', 'https://relay.test', 'pairing'),
      connection('Atlas', 'https://atlas.test', 'connected', 'atlas-team'),
      connection('Atlas retry', 'https://atlas.test', 'pairing'),
      connection('same team', 'https://atlas-alt.test', 'connected', 'atlas-team'),
    ]);
    expect(destinations.map(({ id }) => id)).toEqual(['Atlas', 'Relay']);
  });
});
