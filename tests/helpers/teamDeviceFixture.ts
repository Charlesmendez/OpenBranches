import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { TeamConnections } from '../../electron/team/connections';
import type { SecretVault } from '../../electron/services/secretVault';
import { createDemoSnapshot } from '../../src/data/demo';
import type { Companion } from '../../src/team/device';
export function teamDeviceFixture() {
  vi.useFakeTimers();
  const identity = {
    deviceId: randomUUID(),
    workspaceId: randomUUID(),
    memberId: randomUUID(),
    deviceName: 'Fictional Mac',
    workspaceName: 'Fictional team',
    login: 'fictional-member',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const token = 'obd_' + 'x'.repeat(43);
  const profile: Companion = {
    workspace: { id: identity.workspaceId, name: identity.workspaceName, revision: '1' },
    member: { id: identity.memberId, login: identity.login },
    device: { id: identity.deviceId, name: identity.deviceName, expiresAt: identity.expiresAt },
    projects: [
      {
        id: randomUUID(),
        name: 'Fictional destination',
        githubId: null,
        githubSlug: null,
        canShare: true,
      },
    ],
    shares: [],
    complete: { projects: true, shares: true },
  };
  let saved: string | undefined;
  const vault: SecretVault = {
    read: () => saved,
    write: (value) => {
      saved = value;
    },
  };
  const request = vi.fn<typeof fetch>(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/pairings')
      return Response.json({
        pairingSecret: token,
        userCode: 'ABCD-EFGH-JKLM',
        interval: 5,
        expiresIn: 600,
      });
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer ' + token });
    if (path.endsWith('/current')) return Response.json({ state: 'paired', ...identity });
    if (path.endsWith('/companion')) return Response.json(profile);
    if (path.endsWith('/cancel')) return Response.json({ cancelled: true });
    if (options?.method === 'DELETE') return Response.json({ revision: '2' });
    throw new Error('Unexpected fixture request');
  });
  const snapshot = createDemoSnapshot();
  const service = (onRevoked?: (id: string) => void) =>
    new TeamConnections(
      vault,
      () => snapshot,
      () => {},
      { request, onRevoked },
    );
  const connect = async (connection = service()) => {
    await connection.begin({
      origin: 'https://team.example.test',
      deviceName: identity.deviceName,
    });
    vi.setSystemTime(Date.now() + 5000);
    await connection.refresh(true);
    return connection;
  };
  return { identity, token, profile, vault, request, snapshot, service, connect };
}
