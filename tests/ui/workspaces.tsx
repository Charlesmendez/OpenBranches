import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TeamConnectionsState } from '../../src/team/device';
import {
  WorkspaceSwitcher,
  type WorkspaceTeamApi,
} from '../../src/ui/components/WorkspaceSwitcher';
import { Brand } from '../../src/ui/components/Primitives';
import '../../src/ui/styles.css';
import './workspaces.css';

const state: TeamConnectionsState = {
  allowLoopback: true,
  connections: [
    {
      id: 'connected-team',
      origin: 'https://branches.atlas.test',
      deviceName: 'Carlos’s Mac',
      state: 'connected',
      identity: {
        deviceId: '2d784fc8-bff8-4bf2-9272-393a13b11b56',
        workspaceId: '043daf6c-5cfe-4e0b-92ec-c305a4a9fb67',
        memberId: 'bdfd9456-08f4-462e-b8f7-c68be554dd4b',
        deviceName: 'Carlos’s Mac',
        workspaceName: 'Atlas Engineering',
        login: 'carlos',
        expiresAt: '2027-09-09T00:00:00.000Z',
      },
    },
    {
      id: 'pending-team',
      origin: 'https://branches.studio.test',
      deviceName: 'Carlos’s Mac',
      state: 'pairing',
      pairing: {
        code: 'BCDF-GHJK-MNPQ',
        expiresAt: Date.now() + 300_000,
      },
    },
    {
      id: 'unavailable-team',
      origin: 'https://branches.relay.test',
      deviceName: 'Carlos’s Mac',
      state: 'unavailable',
      identity: {
        deviceId: '064e992a-842b-405b-859a-de15ca731ea7',
        workspaceId: '6a7862ec-579e-436e-bf54-a97a4fc30576',
        memberId: '7ff13e20-33fd-482f-95ad-7a58a0a5ec5e',
        deviceName: 'Carlos’s Mac',
        workspaceName: 'Relay Systems',
        login: 'carlos',
        expiresAt: '2027-09-09T00:00:00.000Z',
      },
    },
  ],
};

function Fixture() {
  const [message, setMessage] = useState('Select the workspace control.');
  const api = useMemo<WorkspaceTeamApi>(
    () => ({
      getTeamConnections: async () => state,
      onTeamConnections: () => () => {},
      openTeam: async (id) => setMessage(`Opened ${id}`),
    }),
    [],
  );
  return (
    <div className="workspace-fixture">
      <aside className="sidebar workspace-fixture-sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <WorkspaceSwitcher
          demo={false}
          api={api}
          onMode={() => {}}
          onSettings={() => setMessage('Opened team settings')}
          onError={setMessage}
        />
        <p className="workspace-fixture-note">Personal projects stay on this Mac.</p>
      </aside>
      <main>
        <span>WORKSPACE SWITCHER</span>
        <h1>Personal and team work, within reach.</h1>
        <p>{message}</p>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
