import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { TeamConfig } from './config';
import type { TeamStore } from './store';
import type { TeamOAuth } from './oauth';
import type { TeamEvents } from './events';
import { requireOwner, workspaceAccess, type Credential } from './access';
import { TeamError, unauthorized } from './errors';
import { secretHash, validSecret } from './secrets';
import { pairingApprovalSchema, teamId } from '../../src/team/protocol';
import type { TeamAssets } from './static';
import { TeamGitHubSetup } from './github/setup';
import { githubNumericId } from '../../src/team/github';

function json(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
function cookieName(config: TeamConfig, kind: 'session' | 'browser') {
  return (config.origin.protocol === 'https:' ? '__Host-' : '') + 'ob_' + kind;
}
function cookie(request: IncomingMessage, name: string) {
  return (
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
function setCookie(
  config: TeamConfig,
  kind: 'session' | 'browser',
  token: string,
  seconds: number,
) {
  return `${cookieName(config, kind)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.origin.protocol === 'https:' ? '; Secure' : ''}`;
}
function credential(request: IncomingMessage, config: TeamConfig): Credential {
  const bearer = /^Bearer (obd_[\w-]{43})$/.exec(request.headers.authorization ?? '');
  if (bearer) return { kind: 'device', token: bearer[1] };
  if (request.headers.authorization) throw unauthorized();
  const token = cookie(request, cookieName(config, 'session'));
  if (!validSecret(token)) throw unauthorized();
  return { kind: 'session', token };
}
function sameOrigin(request: IncomingMessage, config: TeamConfig) {
  if (request.headers.origin !== config.origin.origin)
    throw new TeamError(403, 'origin_denied', 'Open this action from the team workspace.');
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
    throw new TeamError(415, 'json_required', 'Send an application/json request.');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 800_000)
      throw new TeamError(413, 'request_too_large', 'The metadata request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TeamError(400, 'invalid_json', 'The request is not valid JSON.');
  }
}

class RequestLimits {
  private buckets = new Map<string, { start: number; count: number }>();
  allow(request: IncomingMessage, sensitive: boolean) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets)
      if (now - bucket.start > 60_000) this.buckets.delete(key);
    const key =
      secretHash(request.socket.remoteAddress ?? 'unknown') + (sensitive ? ':entry' : ':api');
    const bucket = this.buckets.get(key) ?? { start: now, count: 0 };
    if (!this.buckets.has(key) && this.buckets.size >= 10_000) return false;
    this.buckets.set(key, bucket);
    return ++bucket.count <= (sensitive ? 60 : 1200);
  }
}

export function createTeamServer(
  config: TeamConfig,
  store: TeamStore,
  oauth: TeamOAuth,
  events: TeamEvents,
  assets?: TeamAssets,
  github = new TeamGitHubSetup(store.db),
) {
  const limits = new RequestLimits();
  const streams = new Set<ServerResponse>();
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 16_384 },
    (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      void route(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        if (error instanceof TeamError)
          json(response, error.status, { error: error.code, message: error.message });
        else if (error instanceof z.ZodError)
          json(response, 400, {
            error: 'invalid_request',
            message: 'Some request fields are missing or invalid.',
          });
        else
          json(response, 503, {
            error: 'service_unavailable',
            message: 'The team service is temporarily unavailable. Try again.',
          });
      });
    },
  );
  server.on('close', () => {
    for (const response of streams) response.end();
    streams.clear();
  });
  async function route(request: IncomingMessage, response: ServerResponse) {
    if ((request.url?.length ?? 0) > 4096)
      throw new TeamError(414, 'url_too_long', 'The request URL is too long.');
    const url = new URL(request.url ?? '/', config.origin),
      path = url.pathname,
      method = request.method ?? 'GET';
    if (path === '/health' && method === 'GET') {
      await store.db.pool.query('SELECT 1');
      json(response, 200, { status: 'ok' });
      return;
    }
    if (request.headers.host !== config.origin.host)
      throw new TeamError(421, 'wrong_host', 'Use the configured team service address.');
    if (!limits.allow(request, path.startsWith('/auth/') || path === '/api/pairings'))
      throw new TeamError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
    const asset = assets?.get(path);
    if (asset && (method === 'GET' || method === 'HEAD')) {
      response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': asset.body.byteLength,
      });
      response.end(method === 'HEAD' ? undefined : asset.body);
      return;
    }
    if (path === '/auth/github' && method === 'GET') {
      const started = await oauth.begin();
      response.setHeader('Set-Cookie', setCookie(config, 'browser', started.browser, 600));
      response.writeHead(302, { Location: started.url });
      response.end();
      return;
    }
    if (path === '/auth/callback' && method === 'GET') {
      const signed = await oauth.complete(
        url.searchParams.get('state') ?? '',
        cookie(request, cookieName(config, 'browser')),
        url.searchParams.get('code') ?? '',
        cookie(request, cookieName(config, 'session')),
      );
      response.setHeader('Set-Cookie', [
        setCookie(config, 'session', signed.token, 28800),
        setCookie(config, 'browser', '', 0),
      ]);
      response.writeHead(302, {
        Location: signed.githubWorkspace
          ? '/?workspace=' + signed.githubWorkspace + '&view=github'
          : '/',
      });
      response.end();
      return;
    }
    if (path === '/api/pairings' && method === 'POST') {
      if (request.headers.origin) sameOrigin(request, config);
      json(response, 201, await store.pairings.start(await body(request)));
      return;
    }
    const auth = credential(request, config);
    if (!['GET', 'HEAD'].includes(method) && auth.kind === 'session') sameOrigin(request, config);
    const githubRoute =
      /^\/api\/workspaces\/([^/]+)\/github(?:\/(authorize|catalog|select|projects|work)(?:\/([^/]+))?)?$/.exec(
        path,
      );
    if (githubRoute) {
      const workspace = teamId.parse(githubRoute[1]),
        action = githubRoute[2],
        id = githubRoute[3];
      if (!action && method === 'GET') {
        json(response, 200, await github.state(auth, workspace));
        return;
      }
      if (action === 'authorize' && !id && method === 'POST') {
        const started = await oauth.begin({ credential: auth, workspace });
        response.setHeader('Set-Cookie', setCookie(config, 'browser', started.browser, 600));
        json(response, 200, { url: started.url });
        return;
      }
      if (action === 'catalog' && !id && method === 'POST') {
        const input = z
          .strictObject({ proofId: teamId, installationId: githubNumericId })
          .parse(await body(request));
        json(
          response,
          200,
          await github.catalog(auth, workspace, input.proofId, input.installationId),
        );
        return;
      }
      if (action === 'select' && !id && method === 'POST') {
        json(response, 200, await github.select(auth, workspace, await body(request)));
        return;
      }
      if (action === 'projects' && id && method === 'DELETE') {
        json(response, 200, await github.remove(auth, workspace, teamId.parse(id)));
        return;
      }
      if (action === 'work' && !id && method === 'GET') {
        json(
          response,
          200,
          await store.githubWork.view(auth, workspace, {
            projectId: url.searchParams.get('project') ?? undefined,
            memberId: url.searchParams.get('member') ?? undefined,
            after: url.searchParams.get('cursor') ?? undefined,
            query: url.searchParams.get('q') ?? undefined,
          }),
        );
        return;
      }
      throw new TeamError(404, 'not_found', 'This GitHub endpoint is unavailable.');
    }
    if (path === '/api/session' && method === 'GET') {
      json(response, 200, await store.identities.workspaces(auth));
      return;
    }
    if (path === '/api/session' && method === 'DELETE') {
      if (auth.kind !== 'session') throw unauthorized();
      await store.identities.signOut(auth.token);
      response.setHeader('Set-Cookie', setCookie(config, 'session', '', 0));
      json(response, 200, { signedOut: true });
      return;
    }
    if (path === '/api/workspaces' && method === 'POST') {
      const input = z.strictObject({ name: z.string() }).parse(await body(request));
      json(response, 201, await store.identities.createWorkspace(auth, input.name));
      return;
    }
    if (path === '/api/pairings/current' && method === 'GET') {
      if (auth.kind !== 'device') throw unauthorized();
      json(response, 200, await store.pairings.poll(auth.token));
      return;
    }
    if (path === '/api/pairings/cancel' && method === 'POST') {
      if (auth.kind !== 'device') throw unauthorized();
      await store.pairings.cancel(auth.token);
      json(response, 200, { cancelled: true });
      return;
    }
    if (path === '/api/pairings/inspect' && method === 'POST') {
      const input = pairingApprovalSchema.parse(await body(request));
      json(response, 200, await store.pairings.inspect(auth, input.workspaceId, input.userCode));
      return;
    }
    if (path === '/api/pairings/approve' && method === 'POST') {
      json(response, 200, await store.pairings.approve(auth, await body(request)));
      return;
    }
    const match =
      /^\/api\/workspaces\/([^/]+)\/(view|companion|devices|shares|members|projects|events)(?:\/([^/]+))?(?:\/(snapshots|access)(?:\/([^/]+))?)?$/.exec(
        path,
      );
    if (!match) throw new TeamError(404, 'not_found', 'This endpoint is unavailable.');
    const workspaceId = teamId.parse(match[1]),
      resource = match[2],
      id = match[3] ? teamId.parse(match[3]) : undefined,
      action = match[4],
      memberId = match[5] ? teamId.parse(match[5]) : undefined;
    if (resource === 'companion' && method === 'GET' && !id) {
      json(response, 200, await store.views.companion(auth, workspaceId));
      return;
    }
    if (resource === 'view' && method === 'GET' && !id) {
      const cursor = url.searchParams.get('cursor');
      json(
        response,
        200,
        await store.views.view(auth, workspaceId, {
          projectId: url.searchParams.get('project') ?? undefined,
          memberId: url.searchParams.get('member') ?? undefined,
          after: cursor ? cursor.split(':') : undefined,
          query: url.searchParams.get('q') ?? undefined,
        }),
      );
      return;
    }
    if (resource === 'devices' && method === 'GET' && !id) {
      json(response, 200, await store.views.devices(auth, workspaceId));
      return;
    }
    if (resource === 'devices' && method === 'DELETE' && id && !action) {
      json(response, 200, await store.sharing.revokeDevice(auth, workspaceId, id));
      return;
    }
    if (resource === 'shares' && method === 'GET' && !id) {
      json(response, 200, await store.sharing.state(auth, workspaceId));
      return;
    }
    if (resource === 'shares' && method === 'PUT' && id && !action) {
      json(response, 200, await store.sharing.change(auth, workspaceId, id, await body(request)));
      return;
    }
    if (resource === 'shares' && method === 'POST' && id && action === 'snapshots') {
      json(response, 200, await store.sharing.publish(auth, workspaceId, id, await body(request)));
      return;
    }
    if (resource === 'members' && method === 'POST' && !id) {
      // Verify owner access before making an external account lookup.
      await store.db.transaction(async (client) =>
        requireOwner(await workspaceAccess(client, auth, workspaceId)),
      );
      const input = z.strictObject({ login: z.string().max(39) }).parse(await body(request));
      json(
        response,
        201,
        await store.members.add(auth, workspaceId, await oauth.lookup(input.login)),
      );
      return;
    }
    if (resource === 'members' && method === 'DELETE' && id && !action) {
      json(response, 200, await store.members.remove(auth, workspaceId, id));
      return;
    }
    if (resource === 'projects' && method === 'GET' && id && action === 'access' && !memberId) {
      json(response, 200, await store.views.projectAccess(auth, workspaceId, id));
      return;
    }
    if (resource === 'projects' && method === 'POST' && !id) {
      const input = z.strictObject({ name: z.string() }).parse(await body(request));
      json(response, 201, await store.members.createProject(auth, workspaceId, input.name));
      return;
    }
    if (resource === 'projects' && method === 'DELETE' && id && !action) {
      json(response, 200, await store.members.removeProject(auth, workspaceId, id));
      return;
    }
    if (resource === 'projects' && method === 'PUT' && id && action === 'access' && memberId) {
      const input = z
        .strictObject({ enabled: z.boolean(), canShare: z.boolean() })
        .parse(await body(request));
      json(
        response,
        200,
        await store.members.grant(auth, workspaceId, id, memberId, input.enabled, input.canShare),
      );
      return;
    }
    if (resource === 'events' && method === 'GET' && !id) {
      await stream(request, response, auth, workspaceId);
      return;
    }
    throw new TeamError(404, 'not_found', 'This endpoint is unavailable.');
  }
  async function stream(
    request: IncomingMessage,
    response: ServerResponse,
    auth: Credential,
    workspaceId: string,
  ) {
    if (streams.size >= 1000)
      throw new TeamError(
        503,
        'streams_busy',
        'Live updates are busy. Refresh the workspace shortly.',
      );
    await store.db.transaction((client) => workspaceAccess(client, auth, workspaceId));
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    streams.add(response);
    let revision = '',
      closed = false,
      running = false,
      again = false;
    const send = (name: string, data: unknown) => {
      if (
        !closed &&
        !response.destroyed &&
        !response.writableEnded &&
        !response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      )
        response.end();
    };
    const check = async () => {
      if (closed) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const principal = await store.db.transaction((client) =>
          workspaceAccess(client, auth, workspaceId, false),
        );
        if (principal.revision !== revision) {
          revision = principal.revision;
          send('invalidate', { revision });
        } else send('heartbeat', { revision });
      } catch (error) {
        send(error instanceof TeamError ? 'access_revoked' : 'unavailable', {});
        response.end();
      } finally {
        running = false;
        if (again) {
          again = false;
          void check();
        }
      }
    };
    const unsubscribe = events.subscribe(workspaceId, () => void check());
    const timer = setInterval(() => void check(), 20_000);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
      streams.delete(response);
    };
    request.on('aborted', close);
    response.on('close', close);
    void check();
  }
  return server;
}
