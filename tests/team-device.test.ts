import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamDeviceClient } from '../electron/team/client';
import { teamOrigin } from '../electron/team/origin';
import { createSecretVault } from '../electron/services/secretVault';
import { teamDeviceFixture as fixture } from './helpers/teamDeviceFixture';

afterEach(() => vi.useRealTimers());
describe('Mac team connection boundary', () => {
  it('accepts only a selected secure origin, with loopback limited to development', () => {
    expect(teamOrigin(' https://team.example.test/ ')).toBe('https://team.example.test');
    for (const address of [
      'http://team.example.test',
      'https://name:secret@team.example.test',
      'https://team.example.test/api',
      'https://team.example.test/?secret=x',
      'https://team.example.test/#private',
      'file:///tmp/team',
      'http://127.0.0.1:4321',
    ])
      expect(() => teamOrigin(address)).toThrow();
    expect(teamOrigin('http://127.0.0.1:4321', true)).toBe('http://127.0.0.1:4321');
    expect(() => teamOrigin('http://127.0.0.1.attacker.test', true)).toThrow();
  });
  it('keeps credentials scoped to the origin, omits cookies, and refuses redirects', async () => {
    const f = fixture(),
      connection = await f.connect();
    expect(connection.state().connections[0].identity?.workspaceId).toBe(f.identity.workspaceId);
    const status = JSON.stringify(connection.state());
    expect(status).not.toContain(f.token);
    expect(status).not.toContain('opaqueSecret');
    for (const [url, options] of f.request.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://team.example.test');
      expect(options?.redirect).toBe('error');
      expect(options?.credentials).toBe('omit');
    }
    const redirected = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 302, headers: { Location: 'https://elsewhere.invalid' } }),
      );
    await expect(
      new TeamDeviceClient('https://team.example.test', f.token, redirected).poll(),
    ).rejects.toThrow();
    expect(redirected).toHaveBeenCalledTimes(1);
  });
  it('does not trust server error text with credentials, oversized bodies, or unrelated identities', async () => {
    const f = fixture();
    const rejected = new TeamDeviceClient(
      'https://team.example.test',
      f.token,
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'PRIVATE', message: f.token }, { status: 403 })),
    );
    await expect(rejected.poll()).rejects.toThrow('cannot perform');
    const deniedWithoutJSON = new TeamDeviceClient(
      'https://team.example.test',
      f.token,
      vi.fn().mockResolvedValue(new Response('Sign in', { status: 401 })),
    );
    await expect(deniedWithoutJSON.poll()).rejects.toMatchObject({ status: 401 });
    const oversized = new TeamDeviceClient(
      'https://team.example.test',
      f.token,
      vi.fn().mockResolvedValue(new Response('x'.repeat(2_000_001))),
    );
    await expect(oversized.poll()).rejects.toThrow('too large');
    f.profile.member.id = randomUUID();
    const connection = await f.connect();
    expect(connection.state().connections[0].projects).toBeUndefined();
    expect(connection.state().connections[0].error).toContain('does not match');
  });
  it('honors the pairing interval even when the UI repeatedly refreshes', async () => {
    const f = fixture(),
      connection = f.service();
    await connection.begin({ origin: 'https://team.example.test', deviceName: 'Fictional Mac' });
    await connection.refresh(true);
    await connection.refresh(true);
    expect(f.request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5000);
    await connection.refresh(true);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it('cancels a browser approval that arrives after local cancellation, including its server race', async () => {
    const f = fixture(),
      connection = f.service();
    await connection.begin({ origin: 'https://team.example.test', deviceName: 'Fictional Mac' });
    vi.setSystemTime(Date.now() + 5000);
    let finish!: (value: Response) => void;
    f.request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'pairing_changed', message: 'Retry' }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({ cancelled: true }));
    const poll = connection.refresh(true),
      id = connection.state().connections[0].id;
    const removing = connection.disconnect(id);
    expect(connection.state().connections[0].state).toBe('removing');
    finish(Response.json({ state: 'paired', ...f.identity }));
    await poll;
    await removing;
    expect(connection.state().connections).toEqual([]);
    expect(f.vault.read()).not.toContain(f.token);
    expect(f.request.mock.calls.filter(([url]) => String(url).endsWith('/cancel'))).toHaveLength(2);
  });
  it('persists an offline disconnect and resumes withdrawal after restart', async () => {
    const f = fixture(),
      connection = await f.connect();
    const id = connection.state().connections[0].id;
    f.request.mockRejectedValueOnce(new Error('Offline'));
    await connection.disconnect(id);
    expect(connection.state().connections[0].state).toBe('removing');
    connection.close();
    const restarted = f.service();
    expect(restarted.state().connections[0].state).toBe('removing');
    await restarted.refresh(true);
    expect(restarted.state().connections).toEqual([]);
  });
  it('never sends a revocation when the local cancellation intent could not be saved', async () => {
    const f = fixture(),
      connection = await f.connect();
    f.vault.write = () => {
      throw new Error('Disk unavailable');
    };
    const before = f.request.mock.calls.length;
    await expect(connection.disconnect(connection.state().connections[0].id)).rejects.toThrow(
      'Disk unavailable',
    );
    expect(f.request).toHaveBeenCalledTimes(before);
    expect(connection.state().connections[0].state).toBe('connected');
  });
  it('fails closed on unreadable saved connections and supports an explicit unlock retry', async () => {
    const f = fixture();
    f.vault.write('unreadable');
    const connection = f.service();
    expect(connection.state().error).toContain('could not be opened');
    await expect(
      connection.begin({ origin: 'https://team.example.test', deviceName: 'Fictional Mac' }),
    ).rejects.toThrow('could not be opened');
    expect(f.request).not.toHaveBeenCalled();
    f.vault.write(undefined);
    await connection.refresh(true);
    expect(connection.state().error).toBeUndefined();
  });
  it('marks revoked devices unavailable and requires disconnect before forgetting a live credential', async () => {
    const f = fixture(),
      connection = await f.connect(),
      id = connection.state().connections[0].id;
    expect(() => connection.forget(id)).toThrow('Disconnect');
    f.request.mockResolvedValueOnce(
      Response.json({ error: 'unauthorized', message: 'No access' }, { status: 401 }),
    );
    await connection.refresh(true);
    expect(connection.state().connections[0]).toMatchObject({
      state: 'unavailable',
      projects: undefined,
    });
    connection.forget(id);
    expect(connection.state().connections).toEqual([]);
  });
  it('previews only selected metadata, preserves device keys after restart, and uploads no repositories', async () => {
    const f = fixture(),
      connection = await f.connect();
    const repository = f.snapshot.repositories[0],
      id = connection.state().connections[0].id;
    const input = {
      connectionId: id,
      repositoryId: repository.id,
      projectId: f.profile.projects[0].id,
      consent: { taskTitles: false, taskSummaries: false },
    };
    const preview = await connection.preview(input);
    expect(JSON.stringify(preview.snapshot)).not.toContain(repository.path);
    expect(JSON.stringify(preview.snapshot)).not.toContain(f.token);
    expect(
      preview.snapshot.branches
        .flatMap((b) => b.tasks)
        .every((t) => t.title === undefined && t.summary === undefined),
    ).toBe(true);
    connection.close();
    const restarted = f.service(),
      next = await restarted.preview(input);
    expect(next.snapshot.branches.map((b) => b.key)).toEqual(
      preview.snapshot.branches.map((b) => b.key),
    );
    expect(f.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      1,
    );
    f.profile.projects[0].canShare = false;
    await expect(restarted.preview(input)).rejects.toThrow('cannot share');
  });
});
describe('encrypted connection persistence', () => {
  it('stores only cipher output, rejects malformed records, and never falls back to plaintext', () => {
    let value: unknown;
    const store = {
      readStrict: () => value,
      write: (_key: string, next: unknown) => {
        value = next;
      },
    };
    const cipher = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn(() => Buffer.from('ciphertext')),
      decryptString: vi.fn(() => 'private fixture credential'),
    };
    const vault = createSecretVault(store, 'fixture.credentials', cipher);
    vault.write('private fixture credential');
    expect(value).toBe(Buffer.from('ciphertext').toString('base64'));
    expect(vault.read()).toBe('private fixture credential');
    cipher.isEncryptionAvailable.mockReturnValue(false);
    expect(() => vault.write('private')).toThrow('Keychain');
    expect(() => vault.read()).toThrow('Keychain');
    value = { invalid: true };
    expect(() => vault.read()).toThrow('unreadable');
    vault.write(undefined);
    expect(value).toBeNull();
  });
});
