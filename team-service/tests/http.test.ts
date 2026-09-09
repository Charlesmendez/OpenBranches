import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { TeamDatabase } from '../src/db';
import { TeamStore } from '../src/store';
import { TeamOAuth } from '../src/oauth';
import { TeamEvents } from '../src/events';
import { createTeamServer } from '../src/http';
import { teamConfig, type TeamConfig } from '../src/config';
const databaseUrl = process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('The isolated PostgreSQL test URL is required.');
const db = new TeamDatabase(databaseUrl),
  events = new TeamEvents(db),
  servers: Server[] = [];
let identityId = 400_000_000 + Math.floor(Math.random() * 100_000_000);
beforeAll(async () => {
  await db.migrate();
  await events.start();
});
afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await events.close();
  await db.close();
});
async function fixture() {
  const ownerId = identityId++,
    memberId = identityId++;
  const config: TeamConfig = {
    origin: new URL('http://127.0.0.1:1'),
    databaseUrl: databaseUrl!,
    githubClientId: 'fixture-public-client',
    githubClientSecret: 'PRIVATE SERVER CLIENT SECRET',
    ownerGitHubId: String(ownerId),
    host: '127.0.0.1',
    port: 1,
  };
  const store = new TeamStore(db, String(ownerId));
  const request = vi.fn<typeof fetch>(async (url, options) => {
    const target = String(url);
    let owner = true;
    if (target === 'https://github.com/login/oauth/access_token')
      return Response.json({
        access_token:
          new URLSearchParams(String(options?.body)).get('code') === 'member-code'
            ? 'PRIVATE MEMBER TOKEN'
            : 'PRIVATE OWNER TOKEN',
        refresh_token: 'PRIVATE REFRESH TOKEN',
      });
    if (target === 'https://api.github.com/users/fixture-member') owner = false;
    else
      owner = new Headers(options?.headers).get('Authorization') !== 'Bearer PRIVATE MEMBER TOKEN';
    return Response.json({
      id: owner ? ownerId : memberId,
      login: owner ? 'fixture-owner' : 'fixture-member',
      type: 'User',
      email: 'PRIVATE EMAIL',
    });
  });
  const oauth = new TeamOAuth(db, config, store.identities, request),
    server = createTeamServer(config, store, oauth, events);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  config.origin.port = String(address.port);
  const base = config.origin.origin;
  const api = async (
    path: string,
    options: {
      method?: string;
      cookie?: string;
      device?: string;
      value?: unknown;
      origin?: string;
    } = {},
  ) =>
    fetch(base + path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.device ? { Authorization: `Bearer ${options.device}` } : {}),
        ...(options.value === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.method && options.method !== 'GET' ? { Origin: options.origin ?? base } : {}),
      },
      ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
      redirect: 'manual',
    });
  const begin = async () => {
    const response = await api('/auth/github');
    return {
      url: new URL(response.headers.get('location')!),
      cookie: response.headers.getSetCookie()[0].split(';')[0],
    };
  };
  const login = async (code = 'owner-code') => {
    const start = await begin();
    const response = await api(
      '/auth/callback?' +
        new URLSearchParams({ state: start.url.searchParams.get('state')!, code }),
      { cookie: start.cookie },
    );
    expect(response.status).toBe(302);
    return response.headers.getSetCookie()[0].split(';')[0];
  };
  const setup = async () => {
    const owner = await login(),
      member = await login('member-code');
    const workspace = await (
      await api('/api/workspaces', {
        method: 'POST',
        cookie: owner,
        value: { name: 'Fictional HTTP team' },
      })
    ).json();
    const added = await (
      await api(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        cookie: owner,
        value: { login: 'fixture-member' },
      })
    ).json();
    return { owner, member, workspace, userId: added.id };
  };
  return { config, api, begin, login, setup, request, store };
}
describe('team HTTP and OAuth boundaries', () => {
  it('binds OAuth state to its initiating browser, uses PKCE, and rejects callback replay', async () => {
    const f = await fixture(),
      start = await f.begin(),
      state = start.url.searchParams.get('state')!;
    expect(start.url.origin).toBe('https://github.com');
    expect(start.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.url.searchParams.get('code_challenge')).toHaveLength(43);
    const wrong = await f.api(
      '/auth/callback?' + new URLSearchParams({ state, code: 'owner-code' }),
    );
    expect(wrong.status).toBe(401);
    expect(f.request).not.toHaveBeenCalled();
    const signed = await f.api(
      '/auth/callback?' + new URLSearchParams({ state, code: 'owner-code' }),
      { cookie: start.cookie },
    );
    expect(signed.status).toBe(302);
    expect(signed.headers.getSetCookie()[0]).toContain('HttpOnly');
    expect(signed.headers.getSetCookie()[0]).toContain('SameSite=Lax');
    const verifier = new URLSearchParams(String(f.request.mock.calls[0][1]?.body)).get(
      'code_verifier',
    );
    expect(verifier?.length).toBeGreaterThanOrEqual(43);
    expect(f.request.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
    const session = await f.api('/api/session', {
      cookie: signed.headers.getSetCookie()[0].split(';')[0],
    });
    const data = await session.json();
    expect(data.canCreateWorkspace).toBe(true);
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
    expect(
      (
        await f.api('/auth/callback?' + new URLSearchParams({ state, code: 'owner-code' }), {
          cookie: start.cookie,
        })
      ).status,
    ).toBe(401);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('requires session authentication and same-origin mutations without giving devices owner powers', async () => {
    const f = await fixture(),
      owner = await f.login();
    expect(
      (await f.api('/api/workspaces', { method: 'POST', value: { name: 'No account' } })).status,
    ).toBe(401);
    expect(
      (
        await f.api('/api/workspaces', {
          method: 'POST',
          cookie: owner,
          origin: 'https://untrusted.example',
          value: { name: 'Forged' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.api('/api/session', {
          method: 'DELETE',
          cookie: owner,
          origin: 'https://untrusted.example',
        })
      ).status,
    ).toBe(403);
    expect((await f.api('/api/session', { cookie: owner })).status).toBe(200);
    expect((await f.api('/api/session', { method: 'DELETE', cookie: owner })).status).toBe(200);
    expect((await f.api('/api/session', { cookie: owner })).status).toBe(401);
  });
  it('completes the HTTP pairing and selected-project publishing flow with strict consent', async () => {
    const f = await fixture(),
      s = await f.setup();
    const project = await (
      await f.api(`/api/workspaces/${s.workspace.id}/projects`, {
        method: 'POST',
        cookie: s.owner,
        value: { name: 'Shared local project' },
      })
    ).json();
    await f.api(`/api/workspaces/${s.workspace.id}/projects/${project.id}/access/${s.userId}`, {
      method: 'PUT',
      cookie: s.owner,
      value: { enabled: true, canShare: true },
    });
    const pair = await (
      await f.api('/api/pairings', { method: 'POST', value: { deviceName: 'HTTP fixture Mac' } })
    ).json();
    expect(
      (await f.api(`/api/workspaces/${s.workspace.id}/view`, { device: pair.pairingSecret }))
        .status,
    ).toBe(401);
    const inspected = await f.api('/api/pairings/inspect', {
      method: 'POST',
      cookie: s.member,
      value: { workspaceId: s.workspace.id, userCode: pair.userCode },
    });
    expect(await inspected.json()).toEqual({ deviceName: 'HTTP fixture Mac' });
    const approved = await f.api('/api/pairings/approve', {
      method: 'POST',
      cookie: s.member,
      value: { workspaceId: s.workspace.id, userCode: pair.userCode },
    });
    expect(approved.status).toBe(200);
    expect(
      (await (await f.api('/api/pairings/current', { device: pair.pairingSecret })).json()).state,
    ).toBe('paired');
    expect(
      (
        await f.api(`/api/workspaces/${s.workspace.id}/projects`, {
          method: 'POST',
          device: pair.pairingSecret,
          value: { name: 'Device cannot create' },
        })
      ).status,
    ).toBe(403);
    const share = await (
      await f.api(`/api/workspaces/${s.workspace.id}/shares/${project.id}`, {
        method: 'PUT',
        device: pair.pairingSecret,
        value: {
          expectedEpoch: 0,
          enabled: true,
          consent: { taskTitles: false, taskSummaries: false },
        },
      })
    ).json();
    const value = {
      epoch: share.epoch,
      sequence: 1,
      snapshot: {
        version: 1,
        observedAt: new Date().toISOString(),
        branches: [],
        omittedBranches: 0,
        sourceError: false,
      },
    };
    expect(
      (
        await f.api(`/api/workspaces/${s.workspace.id}/shares/${project.id}/snapshots`, {
          method: 'POST',
          device: pair.pairingSecret,
          value,
        })
      ).status,
    ).toBe(200);
    const view = await (
      await f.api(`/api/workspaces/${s.workspace.id}/view`, { cookie: s.owner })
    ).json();
    expect(view.work).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain(pair.pairingSecret);
    expect(
      (
        await f.api(`/api/workspaces/${s.workspace.id}/shares/${project.id}`, {
          method: 'PUT',
          device: pair.pairingSecret,
          value: {
            expectedEpoch: share.epoch,
            enabled: false,
            consent: { taskTitles: false, taskSummaries: false },
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await f.api(`/api/workspaces/${s.workspace.id}/view`, { cookie: s.owner })).json())
        .work,
    ).toHaveLength(0);
  });
  it('reauthorizes event subscriptions after revocation and never streams snapshot contents', async () => {
    const f = await fixture(),
      s = await f.setup(),
      abort = new AbortController();
    const stream = await fetch(
      `${f.config.origin.origin}/api/workspaces/${s.workspace.id}/events`,
      {
        headers: { Cookie: s.member },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
      },
    );
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const until = async (target: string) => {
      while (!text.includes(target)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Stream closed too early');
        text += decoder.decode(chunk.value);
      }
      return text;
    };
    try {
      await until('invalidate');
      await f.api(`/api/workspaces/${s.workspace.id}/members/${s.userId}`, {
        method: 'DELETE',
        cookie: s.owner,
      });
      await until('access_revoked');
      expect(text).not.toContain('snapshot');
      expect(text).not.toContain('PRIVATE');
      expect(
        (await f.api(`/api/workspaces/${s.workspace.id}/view`, { cookie: s.member })).status,
      ).toBe(401);
    } finally {
      abort.abort();
    }
  });
  it('requires HTTPS for remote service origins and keeps secrets out of API errors', async () => {
    const env = {
      DATABASE_URL: databaseUrl,
      GITHUB_APP_CLIENT_ID: 'client',
      GITHUB_APP_CLIENT_SECRET: 'PRIVATE SECRET',
      OPENBRANCHES_OWNER_GITHUB_ID: '123',
      OPENBRANCHES_TEAM_ORIGIN: 'http://team.example',
    };
    expect(() => teamConfig(env)).toThrow('HTTPS');
    expect(() =>
      teamConfig({ ...env, OPENBRANCHES_TEAM_ORIGIN: 'https://team.example/path' }),
    ).toThrow();
    expect(
      teamConfig({ ...env, OPENBRANCHES_TEAM_ORIGIN: 'https://team.example' }).origin.protocol,
    ).toBe('https:');
    const f = await fixture();
    const bad = await f.api('/api/pairings', {
      method: 'POST',
      value: { deviceName: 'Mac', secret: 'PRIVATE SECRET' },
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('PRIVATE SECRET');
  });
});
