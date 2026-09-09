/** Isolated fictional UI preview only. This entry is never imported by main.ts
 * or copied into the production container. It never reads a real repository. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { TeamDatabase } from '../src/db';
import { TeamStore } from '../src/store';
import { TeamEvents } from '../src/events';
import { TeamOAuth } from '../src/oauth';
import { createTeamServer } from '../src/http';
import { loadTeamAssets } from '../src/static';
import type { TeamConfig } from '../src/config';
import type { Credential } from '../src/access';
import type { SharedSnapshot } from '../../src/team/protocol';
const databaseUrl = process.env.OPENBRANCHES_TEAM_PREVIEW_DATABASE_URL;
if (!databaseUrl || process.env.OPENBRANCHES_TEAM_FICTIONAL_PREVIEW !== '1')
  throw new Error('Use the isolated preview command.');
const db = new TeamDatabase(databaseUrl);
await db.migrate();
const ownerId = 900000001,
  store = new TeamStore(db, String(ownerId)),
  events = new TeamEvents(db);
await events.start();
const names = [
  'ava-chen',
  'leo-martin',
  'maya-patel',
  'noah-rivera',
  'imani-reed',
  'sofia-ross',
  'ethan-park',
  'kai-bell',
];
const sessions = await Promise.all(
  names.map((login, index) =>
    store.identities.signIn({ id: ownerId + index, login, type: 'User' }),
  ),
);
const owners: Credential[] = sessions.map((session) => ({ kind: 'session', token: session.token }));
const workspace = await store.identities.createWorkspace(owners[0], 'Northstar Studio');
for (let index = 1; index < names.length; index++)
  await store.members.add(owners[0], workspace.id, {
    id: ownerId + index,
    login: names[index],
    type: 'User',
  });
const projects = await Promise.all(
  ['Atlas Web', 'Payments', 'Design System', 'Developer Tools'].map((name) =>
    store.members.createProject(owners[0], workspace.id, name),
  ),
);
for (let index = 1; index < names.length; index++)
  for (const project of projects)
    await store.members.grant(
      owners[0],
      workspace.id,
      project.id,
      sessions[index].user.id,
      true,
      true,
    );
let serial = 0;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const intents = [
  'checkout-polish',
  'session-recovery',
  'navigation-accessibility',
  'billing-webhooks',
  'workspace-search',
  'review-inbox',
  'token-refresh',
  'empty-states',
  'branch-grouping',
  'responsive-inspector',
];
for (let index = 0; index < names.length; index++) {
  const pending = await store.pairings.start({
    deviceName: names[index].split('-')[0] + '’s MacBook Pro',
  });
  await store.pairings.approve(owners[index], {
    workspaceId: workspace.id,
    userCode: pending.userCode,
  });
  const device: Credential = { kind: 'device', token: pending.pairingSecret };
  for (let projectIndex = 0; projectIndex < 2; projectIndex++) {
    const project = projects[(index + projectIndex) % projects.length];
    const consent = { taskTitles: true, taskSummaries: false };
    await store.sharing.change(device, workspace.id, project.id, {
      expectedEpoch: 0,
      enabled: true,
      consent,
    });
    const observedAt = new Date(
      Date.now() - (index === 3 ? 35 * 60000 : index === 6 ? 12 * 60000 : 30000),
    ).toISOString();
    const snapshot: SharedSnapshot = {
      version: 1,
      observedAt,
      sourceError: false,
      omittedBranches: 0,
      branches: Array.from({ length: projectIndex === 0 ? 32 : 18 }, (_, branchIndex) => {
        const id = serial++,
          tool = (['codex', 'claude-code', 'cursor'] as const)[(id + index) % 3];
        return {
          key: hash('branch' + id),
          name:
            (branchIndex % 4 ? 'feat/' : 'fix/') +
            intents[(branchIndex + index) % intents.length] +
            '-' +
            (branchIndex + 1),
          detached: false,
          localSha: hash('commit' + id).slice(0, 40),
          remote:
            id % 3
              ? {
                  name: 'origin',
                  sha: hash('commit' + id).slice(0, 40),
                  presence: 'present' as const,
                }
              : undefined,
          worktrees: {
            total: 1,
            available: 1,
            dirty: id % 4 === 0 ? 1 : 0,
            changedFiles: id % 4 === 0 ? 7 : 0,
          },
          integration: [
            {
              name: 'develop',
              sha: 'd'.repeat(40),
              state: id % 4 === 1 ? ('integrated' as const) : ('pending' as const),
            },
            { name: 'main', sha: 'e'.repeat(40), state: 'pending' as const },
          ],
          tasks: [
            {
              key: hash('task' + id),
              tool,
              association: 'verified' as const,
              model: {
                id: tool === 'codex' ? 'gpt-6' : tool === 'claude-code' ? 'claude-opus' : 'grok',
                provider:
                  tool === 'codex'
                    ? ('openai' as const)
                    : tool === 'claude-code'
                      ? ('anthropic' as const)
                      : ('xai' as const),
              },
              title:
                'Improve ' + intents[(branchIndex + index) % intents.length].replaceAll('-', ' '),
              checkedAt: observedAt,
            },
          ],
          omittedTasks: 0,
        };
      }),
    };
    await store.sharing.publish(device, workspace.id, project.id, {
      epoch: 1,
      sequence: 1,
      snapshot,
    });
  }
}
const pairing = await store.pairings.start({ deviceName: 'Fictional review Mac' });
const config: TeamConfig = {
  origin: new URL('http://127.0.0.1:1'),
  databaseUrl,
  githubClientId: 'fictional-preview',
  githubClientSecret: 'fictional-preview',
  ownerGitHubId: String(ownerId),
  host: '127.0.0.1',
  port: 1,
};
const assets = await loadTeamAssets();
const html = assets.get('/')!;
html.body = Buffer.from(
  html.body
    .toString()
    .replace('<head>', '<head><meta name="openbranches-fictional-preview" content="1">'),
);
const oauth = new TeamOAuth(db, config, store.identities, async (url) => {
  const login = String(url).split('/').at(-1) ?? 'fictional-member';
  return Response.json({
    id: 910000000 + Number.parseInt(hash(login).slice(0, 6), 16),
    login,
    type: 'User',
  });
});
const api = createTeamServer(config, store, oauth, events, assets);
const server = createServer((request, response) => {
  if (request.headers.host !== config.origin.host) {
    response.writeHead(421);
    response.end();
    return;
  }
  const path = new URL(request.url ?? '/', config.origin).pathname;
  if (['/auth/github', '/__preview/owner', '/__preview/member'].includes(path)) {
    const session = sessions[path.endsWith('/member') ? 1 : 0];
    response.setHeader(
      'Set-Cookie',
      'ob_session=' + session.token + '; HttpOnly; SameSite=Lax; Path=/',
    );
    response.writeHead(302, { Location: '/' });
    response.end();
    return;
  }
  if (['/', '/team.js', '/team.css'].includes(path)) {
    void loadTeamAssets()
      .then((updated) => {
        const page = updated.get('/')!;
        page.body = Buffer.from(
          page.body
            .toString()
            .replace('<head>', '<head><meta name="openbranches-fictional-preview" content="1">'),
        );
        for (const [key, value] of updated) assets.set(key, value);
        api.emit('request', request, response);
      })
      .catch(() => {
        response.writeHead(503);
        response.end('Build the preview assets and reload.');
      });
    return;
  }
  api.emit('request', request, response);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
config.origin.port = String(address.port);
process.stdout.write('Fictional team preview: ' + config.origin.origin + '/__preview/owner\n');
process.stdout.write('Fictional pairing code: ' + pairing.userCode + ' (expires in ten minutes)\n');
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close(() => {
    api.emit('close');
    void events.close().then(() => db.close());
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
