import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { LIVE_ACTIVITY_TTL } from '../../src/domain/branchActivity';
import type { AgentLiveStatus, LiveAgentTool, Snapshot } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import { linkRepository } from './associations';
import { AgentHookInstaller } from './hookConfig';
import { parseLiveHookEvent } from './liveEvents';
import type { SavedAgentTask } from './types';

const DEFAULT_PORT = 0;
const MAX_BODY = 32 * 1024;
const RETENTION = 5 * 60_000;
const tools: LiveAgentTool[] = ['codex', 'claude-code', 'cursor'];
const toolSchema = z.enum(['codex', 'claude-code', 'cursor']);

export class LiveAgentService {
  private server?: Server;
  private startJob?: Promise<void>;
  private closed = false;
  private token: string;
  private tasks = new Map<string, SavedAgentTask>();
  private values = new Map<LiveAgentTool, AgentLiveStatus>();
  private timer: ReturnType<typeof setInterval>;
  private rate = { startedAt: 0, count: 0 };

  constructor(
    private store: Pick<AppStore, 'read' | 'write'>,
    private publish: () => void,
    private installer = new AgentHookInstaller(),
    private port = DEFAULT_PORT,
  ) {
    const saved = store.read<string>('agents.live.token', '');
    this.token = /^[a-f\d]{64}$/.test(saved) ? saved : randomBytes(32).toString('hex');
    if (this.token !== saved) store.write('agents.live.token', this.token);
    for (const tool of tools) {
      const enabled = store.read<boolean>(`agents.live.${tool}.enabled`, false) === true;
      this.values.set(tool, {
        tool,
        enabled,
        installed: false,
        state: 'not-connected',
        activeCount: 0,
      });
    }
    this.timer = setInterval(() => {
      const changed = this.prune();
      if (changed || [...this.tasks.values()].some((task) => task.runtime)) this.publish();
    }, 15_000);
  }

  start() {
    if (this.closed) return Promise.resolve();
    if (!this.startJob) this.startJob = this.initialize();
    return this.startJob;
  }

  statuses(): AgentLiveStatus[] {
    const now = Date.now();
    return tools.map((tool) => {
      const value = this.values.get(tool)!;
      const activeCount = [...this.tasks.values()].filter(
        (task) =>
          task.tool === tool &&
          task.runtime?.state !== 'idle' &&
          fresh(task.runtime?.checkedAt, now),
      ).length;
      return { ...value, activeCount };
    });
  }

  async setEnabled(tool: LiveAgentTool, enabled: boolean) {
    toolSchema.parse(tool);
    await this.start();
    if (this.closed) return this.statuses();
    const previous = this.values.get(tool)!;
    let configChanged = false;
    try {
      if (enabled) {
        await this.ensureListening();
        await this.installer.install(tool, this.endpoint(tool), this.token);
      } else {
        await this.installer.uninstall(tool);
      }
      configChanged = true;
      this.store.write(`agents.live.${tool}.enabled`, enabled);
      if (!enabled)
        for (const [id, task] of this.tasks) if (task.tool === tool) this.tasks.delete(id);
      this.values.set(tool, {
        tool,
        enabled,
        installed: enabled,
        state: enabled ? 'listening' : 'not-connected',
        activeCount: 0,
      });
      if (!tools.some((candidate) => this.values.get(candidate)?.enabled)) await this.stopServer();
    } catch {
      if (configChanged) {
        try {
          if (enabled) await this.installer.uninstall(tool);
          else {
            await this.ensureListening();
            await this.installer.install(tool, this.endpoint(tool), this.token);
          }
        } catch {
          /* Status below reports whether the owned hook remains installed. */
        }
      }
      let installed = previous.installed;
      try {
        installed = await this.installer.installed(tool);
      } catch {
        /* Keep the last known state when the settings file cannot be inspected. */
      }
      if (!tools.some((candidate) => this.values.get(candidate)?.enabled)) await this.stopServer();
      this.values.set(tool, {
        ...previous,
        installed,
        state: 'error',
        error: enabled
          ? `Could not finish the OpenBranches hook setup for ${toolName(tool)}. Existing settings were preserved.`
          : `Could not remove the OpenBranches hook from ${toolName(tool)}. Try again.`,
      });
      this.publish();
      throw new Error(this.values.get(tool)!.error);
    }
    this.publish();
    return this.statuses();
  }

  enrich(snapshot: Snapshot): Snapshot {
    this.prune();
    const enabled = new Set(
      this.statuses()
        .filter((status) => status.enabled)
        .map((status) => status.tool),
    );
    const tasks = [...this.tasks.values()].filter((task) =>
      enabled.has(task.tool as LiveAgentTool),
    );
    return {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) =>
        tools.reduce(
          (current, tool) =>
            linkRepository(
              current,
              tasks.filter((task) => task.tool === tool),
              new Date().toISOString(),
              tool,
              { merge: true },
            ),
          repository,
        ),
      ),
    };
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.tasks.clear();
    await this.stopServer();
  }

  private async initialize() {
    for (const tool of tools) {
      const current = this.values.get(tool)!;
      try {
        const installed = await this.installer.installed(tool);
        this.values.set(tool, { ...current, installed });
      } catch {
        this.values.set(tool, {
          ...current,
          state: 'error',
          error: `Could not inspect ${toolName(tool)} hook settings.`,
        });
      }
    }
    if (tools.some((tool) => this.values.get(tool)?.enabled)) {
      try {
        await this.ensureListening();
      } catch {
        for (const tool of tools) {
          const current = this.values.get(tool)!;
          if (current.enabled)
            this.values.set(tool, {
              ...current,
              state: 'error',
              error: 'The private local activity listener could not start. Try again.',
            });
        }
        this.publish();
        return;
      }
      for (const tool of tools) {
        const current = this.values.get(tool)!;
        if (!current.enabled) continue;
        try {
          await this.installer.install(tool, this.endpoint(tool), this.token);
          this.values.set(tool, {
            ...current,
            installed: true,
            state: 'listening',
            error: undefined,
          });
        } catch {
          this.values.set(tool, {
            ...current,
            state: 'error',
            error: `Could not repair the ${toolName(tool)} live activity hook. Connect it again.`,
          });
        }
      }
    }
    this.publish();
  }

  private async ensureListening() {
    if (this.server?.listening) return;
    const server = createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = 2_000;
    server.headersTimeout = 2_000;
    await new Promise<void>((resolve, reject) => {
      const error = (cause: Error) => reject(cause);
      server.once('error', error);
      server.listen(this.port, '127.0.0.1', () => {
        server.off('error', error);
        resolve();
      });
    });
    this.server = server;
    server.on('error', () => {
      for (const tool of tools) {
        const current = this.values.get(tool)!;
        if (current.enabled)
          this.values.set(tool, {
            ...current,
            state: 'error',
            error: 'The private local activity listener stopped. Try again.',
          });
      }
      this.publish();
    });
  }

  private endpoint(tool: LiveAgentTool) {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('Local hook listener is not running.');
    return `http://127.0.0.1:${address.port}/v1/events/${tool}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return finish(response, 405);
    const match = /^\/v1\/events\/(codex|claude-code|cursor)$/.exec(request.url ?? '');
    if (!match) return finish(response, 404);
    if (request.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json')
      return finish(response, 415);
    if (!this.authorized(request.headers.authorization)) return finish(response, 401);
    const tool = toolSchema.parse(match[1]);
    if (!this.values.get(tool)?.enabled) return finish(response, 403);
    if (!this.withinRateLimit()) return finish(response, 429);
    try {
      const body = await readBody(request);
      const event = parseLiveHookEvent(tool, JSON.parse(body));
      const now = new Date().toISOString();
      const key = `${event.tool}:${event.id}`;
      const previous = this.tasks.get(key);
      this.tasks.set(key, {
        id: event.id,
        tool: event.tool,
        cwd: event.cwd,
        name: previous?.name,
        model: event.model ?? previous?.model,
        updatedAt: Date.parse(now) / 1000,
        checkedAt: now,
        runtime: {
          state: event.state,
          checkedAt: now,
          source:
            event.tool === 'codex'
              ? 'codex-hook'
              : event.tool === 'claude-code'
                ? 'claude-hook'
                : 'cursor-hook',
        },
      });
      const current = this.values.get(event.tool)!;
      this.values.set(event.tool, { ...current, receivedAt: now, error: undefined });
      this.publish();
      finish(response, 204);
    } catch (error) {
      if (!(error instanceof BodyTooLarge)) {
        const current = this.values.get(tool)!;
        this.values.set(tool, {
          ...current,
          error: `The latest ${toolName(tool)} signal did not identify one supported local checkout.`,
        });
        this.publish();
      }
      finish(response, error instanceof BodyTooLarge ? 413 : 422);
    }
  }

  private authorized(value: string | undefined) {
    if (!value?.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(value.slice(7));
    const expected = Buffer.from(this.token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private withinRateLimit() {
    const now = Date.now();
    if (now - this.rate.startedAt >= 60_000) this.rate = { startedAt: now, count: 0 };
    return ++this.rate.count <= 600;
  }

  private prune() {
    const cutoff = Date.now() - RETENTION;
    let changed = false;
    for (const [id, task] of this.tasks) {
      if (Date.parse(task.runtime?.checkedAt ?? '') < cutoff) {
        this.tasks.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  private async stopServer() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function toolName(tool: LiveAgentTool) {
  return tool === 'codex' ? 'Codex' : tool === 'claude-code' ? 'Claude Code' : 'Cursor';
}

class BodyTooLarge extends Error {}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) {
      request.resume();
      throw new BodyTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function finish(response: ServerResponse, status: number) {
  response.statusCode = status;
  response.end();
}

function fresh(value: string | undefined, now: number) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= LIVE_ACTIVITY_TTL;
}
