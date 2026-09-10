import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { TeamDatabase } from '../src/db';
import { TeamStore } from '../src/store';
import { TeamOAuth } from '../src/oauth';
import { TeamEvents } from '../src/events';
import { TeamGitHubApp } from '../src/github/app';
import { TeamGitHubSetup } from '../src/github/setup';
import { TeamGitHubSync } from '../src/github/sync';
import { loadGitHubSetup } from '../src/github/load';
import { createTeamServer } from '../src/http';
import type { TeamConfig } from '../src/config';
import type { Credential } from '../src/access';
import { branchSha, fictionalGitHub, pem, response, type Intercept } from '../dev/githubFixture';

const url = process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL;
if (!url) throw new Error('Run with an isolated PostgreSQL test database.');
const db = new TeamDatabase(url),
  events = new TeamEvents(db),
  servers: Server[] = [];
beforeAll(async () => {
  await db.migrate();
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
async function fixture(intercept?: Intercept) {
  const source = fictionalGitHub(intercept),
    request = vi.fn(source.request),
    app = new TeamGitHubApp('fixture-client', pem, request),
    setup = new TeamGitHubSetup(db, app),
    store = new TeamStore(db, '61');
  const identity = { id: 61, login: 'fictional-person', type: 'User' as const };
  const signed = await store.identities.signIn(identity),
    memberSigned = await store.identities.signIn({
      id: 62,
      login: 'fictional-member',
      type: 'User',
    });
  const owner: Credential = { kind: 'session', token: signed.token },
    member: Credential = { kind: 'session', token: memberSigned.token };
  const workspace = await store.identities.createWorkspace(owner, 'GitHub fixture ' + randomUUID());
  await store.members.add(owner, workspace.id, { id: 62, login: 'fictional-member', type: 'User' });
  const config: TeamConfig = {
    origin: new URL('http://127.0.0.1:1'),
    databaseUrl: url!,
    githubClientId: 'fixture-client',
    githubClientSecret: 'fictional-client-secret',
    ownerGitHubId: '61',
    host: '127.0.0.1',
    port: 1,
  };
  const oauth = new TeamOAuth(db, config, store.identities, request, setup);
  const review = async () => {
    const proof = await setup.verify(owner, workspace.id, identity, 'fictional-user-token');
    return setup.catalog(owner, workspace.id, proof.id, '31');
  };
  return {
    app,
    request,
    setup,
    store,
    signed,
    memberSigned,
    identity,
    owner,
    member,
    workspace,
    config,
    oauth,
    review,
  };
}
describe('GitHub workspace setup', () => {
  it('loads only an explicit bounded host key and leaves repository setup off when no key is configured', async () => {
    const f = await fixture(),
      directory = await mkdtemp(join(tmpdir(), 'openbranches-github-key-test-'));
    try {
      const key = join(directory, 'fictional.pem');
      await writeFile(key, pem, { mode: 0o600 });
      expect(
        (
          await (
            await loadGitHubSetup({ ...f.config, githubPrivateKeyFile: key }, db)
          ).state(f.owner, f.workspace.id)
        ).configured,
      ).toBe(true);
      expect(
        (await (await loadGitHubSetup(f.config, db)).state(f.owner, f.workspace.id)).configured,
      ).toBe(false);
      await expect(
        loadGitHubSetup({ ...f.config, githubPrivateKeyFile: 'relative.pem' }, db),
      ).rejects.toThrow('absolute');
      await writeFile(key, 'x'.repeat(32_001));
      await expect(loadGitHubSetup({ ...f.config, githubPrivateKeyFile: key }, db)).rejects.toThrow(
        'too large',
      );
      await writeFile(key, 'not a private key');
      await expect(loadGitHubSetup({ ...f.config, githubPrivateKeyFile: key }, db)).rejects.toThrow(
        'valid RSA',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('discards a catalog when organization ownership changes during its network read', async () => {
    let catalogRead = false;
    const f = await fixture((path) => {
      if (path.startsWith('/installation/repositories?')) catalogRead = true;
      if (catalogRead && path.includes('/memberships/'))
        return response({
          role: 'member',
          state: 'active',
          organization: { id: 41 },
          user: { id: 61 },
        });
      return undefined;
    });
    const proof = await f.setup.verify(f.owner, f.workspace.id, f.identity, 'fictional-user-token');
    await expect(f.setup.catalog(f.owner, f.workspace.id, proof.id, '31')).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (
        await db.pool.query(
          "SELECT id FROM ob_github_reviews WHERE workspace_id=$1 AND kind='catalog'",
          [f.workspace.id],
        )
      ).rows,
    ).toEqual([]);
  });
  it('removing a team project clears its GitHub selection and invalidates old approval reviews', async () => {
    const f = await fixture(),
      first = await f.review();
    await f.setup.select(f.owner, f.workspace.id, { reviewId: first.id, repositoryIds: ['51'] });
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId;
    const second = await f.review();
    await f.store.members.removeProject(f.owner, f.workspace.id, project);
    await expect(
      f.setup.select(f.owner, f.workspace.id, { reviewId: second.id, repositoryIds: ['51'] }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
    expect((await f.store.views.view(f.owner, f.workspace.id)).projects).toEqual([]);
  });
  it('binds OAuth to the original owner session and workspace, and persists only verified identities', async () => {
    const f = await fixture();
    const started = await f.oauth.begin({ credential: f.owner, workspace: f.workspace.id });
    const state = new URL(started.url).searchParams.get('state')!;
    const complete = await f.oauth.complete(
      state,
      started.browser,
      'fictional-code',
      f.owner.token,
    );
    expect(complete).toMatchObject({ token: f.owner.token, githubWorkspace: f.workspace.id });
    const result = await f.setup.state(f.owner, f.workspace.id);
    expect(result.proof?.installations).toHaveLength(1);
    expect(result.selections).toEqual([]);
    const saved = await db.pool.query(
      'SELECT payload FROM ob_github_reviews WHERE workspace_id=$1',
      [f.workspace.id],
    );
    expect(JSON.stringify(saved.rows)).not.toMatch(
      /fictional-user-token|fictional-installation-token|fictional-client-secret|BEGIN PRIVATE KEY/,
    );
    await expect(
      f.oauth.complete(state, started.browser, 'fictional-code', f.owner.token),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('rejects another browser session and a different signed-in GitHub identity before installation discovery', async () => {
    const f = await fixture();
    const started = await f.oauth.begin({ credential: f.owner, workspace: f.workspace.id });
    const other = await f.store.identities.signIn(f.identity);
    await expect(
      f.oauth.complete(
        new URL(started.url).searchParams.get('state')!,
        started.browser,
        'code',
        other.token,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(f.request).not.toHaveBeenCalled();
    const wrong = await fixture((path) =>
      path === '/user' ? response({ id: 62, login: 'fictional-member', type: 'User' }) : undefined,
    );
    const attempt = await wrong.oauth.begin({
      credential: wrong.owner,
      workspace: wrong.workspace.id,
    });
    await expect(
      wrong.oauth.complete(
        new URL(attempt.url).searchParams.get('state')!,
        attempt.browser,
        'code',
        wrong.owner.token,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      wrong.request.mock.calls.some(([url]) => String(url).includes('/user/installations')),
    ).toBe(false);
  });
  it('keeps proof and selection operations owner-only and requires host configuration', async () => {
    const f = await fixture();
    await expect(
      f.oauth.begin({ credential: f.member, workspace: f.workspace.id }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.setup.state(f.member, f.workspace.id)).rejects.toMatchObject({ status: 403 });
    const pair = await f.store.pairings.start({ deviceName: 'Fictional owner Mac' });
    await f.store.pairings.approve(f.owner, {
      workspaceId: f.workspace.id,
      userCode: pair.userCode,
    });
    await expect(
      f.setup.state({ kind: 'device', token: pair.pairingSecret }, f.workspace.id),
    ).rejects.toMatchObject({ status: 403 });
    const off = new TeamGitHubSetup(db);
    expect(await off.state(f.owner, f.workspace.id)).toMatchObject({
      configured: false,
      selections: [],
    });
    await expect(off.start(f.owner, f.workspace.id)).rejects.toMatchObject({
      code: 'github_not_configured',
    });
  });
  it('selects stable repository IDs once, preserves choices after coordinator restart, and grants no member access implicitly', async () => {
    const f = await fixture(),
      catalog = await f.review();
    const command = { reviewId: catalog.id, repositoryIds: ['51'] };
    await f.setup.select(f.owner, f.workspace.id, command);
    const restarted = new TeamGitHubSetup(db, f.app),
      state = await restarted.state(f.owner, f.workspace.id);
    expect(state.selections).toEqual([
      expect.objectContaining({ repositoryId: '51', fullName: 'FictionalOrg/work' }),
    ]);
    expect((await f.store.views.view(f.member, f.workspace.id)).projects).toEqual([]);
    expect((await f.store.views.view(f.owner, f.workspace.id)).projects).toHaveLength(1);
    await expect(f.setup.select(f.owner, f.workspace.id, command)).rejects.toMatchObject({
      code: 'github_review_expired',
    });
    expect(
      (
        await db.pool.query('SELECT snapshot FROM ob_github_sources WHERE workspace_id=$1', [
          f.workspace.id,
        ])
      ).rows,
    ).toEqual([{ snapshot: null }]);
  });
  it('rejects forged choices, other workspaces, other sessions and expired catalog reviews', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await expect(
      f.setup.select(f.owner, f.workspace.id, { reviewId: catalog.id, repositoryIds: ['999'] }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    await expect(
      f.setup.select(f.owner, f.workspace.id, {
        reviewId: catalog.id,
        repositoryIds: ['51'],
        installationId: '999',
      }),
    ).rejects.toThrow();
    const other = await f.store.identities.createWorkspace(f.owner, 'Other ' + randomUUID());
    await expect(
      f.setup.select(f.owner, other.id, { reviewId: catalog.id, repositoryIds: ['51'] }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    const session = await f.store.identities.signIn(f.identity);
    await expect(
      f.setup.select({ kind: 'session', token: session.token }, f.workspace.id, {
        reviewId: catalog.id,
        repositoryIds: ['51'],
      }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    await db.pool.query(
      "UPDATE ob_github_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [catalog.id],
    );
    await expect(
      f.setup.select(f.owner, f.workspace.id, { reviewId: catalog.id, repositoryIds: ['51'] }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
  });
  it('rechecks organization ownership after preview and rejects a repository rename', async () => {
    let lost = false,
      renamed = false;
    const f = await fixture((path) =>
      lost && path.includes('/memberships/')
        ? response({ role: 'member', state: 'active', organization: { id: 41 }, user: { id: 61 } })
        : renamed && path.startsWith('/installation/repositories?')
          ? response({ total_count: 0, repositories: [] })
          : undefined,
    );
    const catalog = await f.review();
    lost = true;
    await expect(
      f.setup.select(f.owner, f.workspace.id, { reviewId: catalog.id, repositoryIds: ['51'] }),
    ).rejects.toMatchObject({ status: 403 });
    lost = false;
    renamed = true;
    await expect(
      f.setup.select(f.owner, f.workspace.id, { reviewId: catalog.id, repositoryIds: ['51'] }),
    ).rejects.toMatchObject({ code: 'github_review_expired' });
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
  });
  it('removes a selection without touching the team project or opted-in local snapshot', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, { reviewId: catalog.id, repositoryIds: ['51'] });
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId;
    const pair = await f.store.pairings.start({ deviceName: 'Fictional sharing Mac' });
    await f.store.pairings.approve(f.owner, {
      workspaceId: f.workspace.id,
      userCode: pair.userCode,
    });
    const device: Credential = { kind: 'device', token: pair.pairingSecret },
      consent = { taskTitles: false, taskSummaries: false };
    await f.store.sharing.change(device, f.workspace.id, project, {
      expectedEpoch: 0,
      enabled: true,
      consent,
    });
    await f.store.sharing.publish(device, f.workspace.id, project, {
      epoch: 1,
      sequence: 1,
      snapshot: {
        version: 1,
        observedAt: new Date().toISOString(),
        sourceError: false,
        omittedBranches: 0,
        branches: [],
      },
    });
    await f.setup.remove(f.owner, f.workspace.id, project);
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
    expect((await f.store.views.view(f.owner, f.workspace.id)).projects).toHaveLength(1);
    expect((await f.store.sharing.state(device, f.workspace.id))[0]).toMatchObject({
      enabled: true,
      epoch: 1,
    });
  });
  it('cannot restore a removed selection when an earlier approval is still reading GitHub', async () => {
    let hold = false,
      entered!: () => void,
      release!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    const f = await fixture(async (path) => {
      if (hold && path.startsWith('/installation/repositories?')) {
        entered();
        await gate;
      }
      return undefined;
    });
    const first = await f.review();
    await f.setup.select(f.owner, f.workspace.id, { reviewId: first.id, repositoryIds: ['51'] });
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId;
    const second = await f.review();
    hold = true;
    const attempt = f.setup.select(f.owner, f.workspace.id, {
      reviewId: second.id,
      repositoryIds: ['51'],
    });
    const rejected = expect(attempt).rejects.toMatchObject({ code: 'github_review_expired' });
    await waiting;
    await f.setup.remove(f.owner, f.workspace.id, project);
    release();
    await rejected;
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
  });
  it('requires same-origin browser authorization and serves the full OAuth return and catalog flow', async () => {
    const f = await fixture(),
      server = createTeamServer(f.config, f.store, f.oauth, events, undefined, f.setup);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    f.config.origin.port = String(address.port);
    const root = f.config.origin.origin,
      cookie = 'ob_session=' + f.owner.token,
      path = '/api/workspaces/' + f.workspace.id + '/github';
    expect(
      (
        await fetch(root + path + '/authorize', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://elsewhere.example' },
        })
      ).status,
    ).toBe(403);
    const begun = await fetch(root + path + '/authorize', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: root },
    });
    expect(begun.status).toBe(200);
    const url = new URL((await begun.json()).url),
      browser = begun.headers.get('set-cookie')!.split(';')[0];
    const callback = await fetch(
      root + '/auth/callback?state=' + url.searchParams.get('state') + '&code=fixture',
      { headers: { Cookie: cookie + '; ' + browser }, redirect: 'manual' },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/?workspace=' + f.workspace.id + '&view=github');
    const state = await (await fetch(root + path, { headers: { Cookie: cookie } })).json();
    const catalog = await fetch(root + path + '/catalog', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: root, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proofId: state.proof.id, installationId: '31' }),
    });
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).projects).toHaveLength(1);
  });
  it('refreshes selected repositories and exposes bounded background status without private bodies', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    const sync = new TeamGitHubSync(db, f.app);
    await sync.refresh(true);
    const [selection] = (await f.setup.state(f.owner, f.workspace.id)).selections;
    expect(selection).toMatchObject({
      repositoryId: '51',
      syncState: 'current',
      branchCount: 2,
      pullCount: 1,
      openPullCount: 1,
    });
    expect(selection.snapshotAt).toMatch(/^\d{4}-\d\d-/);
    expect(selection.lastAttemptAt).toMatch(/^\d{4}-\d\d-/);
    const saved = await db.pool.query(
      'SELECT snapshot,attention FROM ob_github_sources WHERE workspace_id=$1',
      [f.workspace.id],
    );
    expect(saved.rows[0].attention).toMatchObject({ counts: { failingChecks: 1 } });
    expect(JSON.stringify(saved.rows)).not.toMatch(/PRIVATE_BODY|PRIVATE_LOG|PRIVATE_PATCH/);
  });
  it('presents permission-scoped GitHub branches, PRs, checks and target history without private provider data', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    const sync = new TeamGitHubSync(db, f.app);
    await sync.refresh(true);
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId;
    const ownerView = await f.store.githubWork.view(f.owner, f.workspace.id);
    expect(ownerView.sources).toHaveLength(1);
    expect(ownerView.sources[0]).toMatchObject({
      projectId: project,
      repositoryId: '51',
      fullName: 'FictionalOrg/work',
      syncState: 'current',
      branchesComplete: true,
      pullHistoryComplete: true,
      openPullCount: 1,
    });
    expect(ownerView.sources[0].branches).toEqual([
      expect.objectContaining({
        name: 'feature/shared',
        sha: branchSha,
        targets: [expect.objectContaining({ name: 'develop', state: 'pending' })],
        pullNumbers: [1],
      }),
    ]);
    expect(ownerView.sources[0].pulls).toEqual([
      expect.objectContaining({
        number: 1,
        author: expect.objectContaining({ id: '61', login: 'fictional-person' }),
        checks: expect.objectContaining({ state: 'failed', label: '1 check needs attention' }),
      }),
    ]);
    expect(JSON.stringify(ownerView)).not.toMatch(/PRIVATE_BODY|PRIVATE_LOG|PRIVATE_PATCH|TOKEN/);

    expect((await f.store.githubWork.view(f.member, f.workspace.id)).sources).toEqual([]);
    await f.store.members.grant(
      f.owner,
      f.workspace.id,
      project,
      f.memberSigned.user.id,
      true,
      false,
    );
    expect((await f.store.githubWork.view(f.member, f.workspace.id)).sources).toHaveLength(1);
    expect(
      (
        await f.store.githubWork.view(f.owner, f.workspace.id, {
          memberId: f.signed.user.id,
          query: '#1',
        })
      ).sources[0].pulls,
    ).toHaveLength(1);
    expect(
      (
        await f.store.githubWork.view(f.owner, f.workspace.id, {
          memberId: f.memberSigned.user.id,
        })
      ).sources,
    ).toEqual([]);
  });
  it('serves GitHub work to authorized browser sessions and rejects device credentials', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    await new TeamGitHubSync(db, f.app).refresh(true);
    const server = createTeamServer(f.config, f.store, f.oauth, events, undefined, f.setup);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    f.config.origin.port = String(address.port);
    const root = f.config.origin.origin,
      path = `/api/workspaces/${f.workspace.id}/github/work?q=feature%2Fshared`;
    const response = await fetch(root + path, {
      headers: { Cookie: 'ob_session=' + f.owner.token },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).sources[0]).toMatchObject({ fullName: 'FictionalOrg/work' });
    const pair = await f.store.pairings.start({ deviceName: 'Fictional read-only Mac' });
    await f.store.pairings.approve(f.owner, {
      workspaceId: f.workspace.id,
      userCode: pair.userCode,
    });
    expect(
      (
        await fetch(root + path, {
          headers: { Authorization: 'Bearer ' + pair.pairingSecret },
        })
      ).status,
    ).toBe(403);
  });
  it('preserves the last verified snapshot after a failed refresh and retries by status', async () => {
    let failing = false;
    const f = await fixture((path) => {
      if (failing && path.includes('/branches?')) throw new Error('PRIVATE_PROVIDER_FAILURE');
      return undefined;
    });
    const catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    const sync = new TeamGitHubSync(db, f.app);
    await sync.refresh(true);
    const before = await db.pool.query(
      'SELECT snapshot,attention FROM ob_github_sources WHERE workspace_id=$1',
      [f.workspace.id],
    );
    failing = true;
    await sync.refresh(true);
    const [selection] = (await f.setup.state(f.owner, f.workspace.id)).selections;
    expect(selection).toMatchObject({
      syncState: 'error',
      branchCount: 2,
      openPullCount: 1,
    });
    const after = await db.pool.query(
      'SELECT snapshot,attention FROM ob_github_sources WHERE workspace_id=$1',
      [f.workspace.id],
    );
    expect(after.rows[0].snapshot).toEqual(before.rows[0].snapshot);
    expect(JSON.stringify(after.rows)).not.toContain('PRIVATE_PROVIDER_FAILURE');
  });
  it('keeps the attention queue permission-scoped, personal, revision-safe, and browser-only', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    await new TeamGitHubSync(db, f.app).refresh(true);
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId,
      ownerPage = await f.store.attention.view(f.owner, f.workspace.id);
    expect(ownerPage).toMatchObject({
      queue: { active: 1, snoozed: 0, dismissed: 0 },
      signals: { failingChecks: 1 },
      sources: 1,
    });
    expect(ownerPage.items[0]).toMatchObject({
      projectId: project,
      kind: 'checks-failing',
      state: 'active',
      forYou: false,
    });
    expect((await f.store.attention.view(f.member, f.workspace.id)).items).toEqual([]);
    await f.store.members.grant(
      f.owner,
      f.workspace.id,
      project,
      f.memberSigned.user.id,
      true,
      false,
    );
    const memberPage = await f.store.attention.view(f.member, f.workspace.id),
      item = memberPage.items[0];
    await expect(
      f.store.attention.decide(f.member, f.workspace.id, {
        choice: 'dismissed',
        items: [{ source: 'github', id: item.id, revision: '0'.repeat(64) }],
      }),
    ).rejects.toMatchObject({ code: 'attention_changed' });
    await f.store.attention.decide(f.member, f.workspace.id, {
      choice: 'dismissed',
      items: [{ source: 'github', id: item.id, revision: item.revision }],
    });
    expect((await f.store.attention.view(f.member, f.workspace.id)).queue).toEqual({
      active: 0,
      snoozed: 0,
      dismissed: 1,
    });
    expect((await f.store.attention.view(f.owner, f.workspace.id)).queue.active).toBe(1);
    const dismissed = await f.store.attention.view(f.member, f.workspace.id, {
      bucket: 'dismissed',
    });
    await f.store.attention.decide(f.member, f.workspace.id, {
      choice: 'restore',
      items: [
        {
          source: 'github',
          id: dismissed.items[0].id,
          revision: dismissed.items[0].revision,
        },
      ],
    });
    expect((await f.store.attention.view(f.member, f.workspace.id)).queue.active).toBe(1);

    const pair = await f.store.pairings.start({ deviceName: 'Fictional queue device' });
    await f.store.pairings.approve(f.owner, {
      workspaceId: f.workspace.id,
      userCode: pair.userCode,
    });
    await expect(
      f.store.attention.view({ kind: 'device', token: pair.pairingSecret }, f.workspace.id),
    ).rejects.toMatchObject({ status: 403 });
    await f.store.attention.decide(f.member, f.workspace.id, {
      choice: 'dismissed',
      items: [{ source: 'github', id: item.id, revision: item.revision }],
    });
    await f.setup.remove(f.owner, f.workspace.id, project);
    expect(
      (
        await db.pool.query('SELECT 1 FROM ob_attention_decisions WHERE workspace_id=$1', [
          f.workspace.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('serves attention decisions through same-origin browser endpoints', async () => {
    const f = await fixture(),
      catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    await new TeamGitHubSync(db, f.app).refresh(true);
    const server = createTeamServer(f.config, f.store, f.oauth, events, undefined, f.setup);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    f.config.origin.port = String(address.port);
    const root = f.config.origin.origin,
      path = `/api/workspaces/${f.workspace.id}/attention`,
      first = await fetch(root + path, { headers: { Cookie: 'ob_session=' + f.owner.token } }),
      page = await first.json();
    expect(first.status).toBe(200);
    expect(page.items).toHaveLength(1);
    expect(
      (
        await fetch(root + path + '/decisions', {
          method: 'POST',
          headers: {
            Cookie: 'ob_session=' + f.owner.token,
            Origin: root,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            choice: 'snoozed',
            items: [
              {
                source: 'github',
                id: page.items[0].id,
                revision: page.items[0].revision,
              },
            ],
          }),
        })
      ).status,
    ).toBe(200);
    const active = await (
      await fetch(root + path, { headers: { Cookie: 'ob_session=' + f.owner.token } })
    ).json();
    expect(active.queue).toMatchObject({ active: 0, snoozed: 1 });
  });
  it('discards a completed background read when its selection is removed', async () => {
    let hold = false,
      entered!: () => void,
      release!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    const f = await fixture(async (path) => {
      if (hold && path.includes('/branches?')) {
        entered();
        await gate;
      }
      return undefined;
    });
    const catalog = await f.review();
    await f.setup.select(f.owner, f.workspace.id, {
      reviewId: catalog.id,
      repositoryIds: ['51'],
    });
    const project = (await f.setup.state(f.owner, f.workspace.id)).selections[0].projectId;
    hold = true;
    const sync = new TeamGitHubSync(db, f.app),
      running = sync.refresh(true);
    await waiting;
    await f.setup.remove(f.owner, f.workspace.id, project);
    release();
    await running;
    expect((await f.setup.state(f.owner, f.workspace.id)).selections).toEqual([]);
  });
});
