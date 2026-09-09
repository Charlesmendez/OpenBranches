import type { Notification, PoolClient } from 'pg';
import { z } from 'zod';
import { teamId } from '../../src/team/protocol';
import { TeamDatabase } from './db';

const notice = z.strictObject({ workspaceId: teamId, revision: z.string().regex(/^\d+$/) });

/** Notifications invalidate authorized reads; they never carry shared work. */
export class TeamEvents {
  private connection?: { client: PoolClient; release: (broken?: boolean) => void };
  private connecting?: Promise<void>;
  private listeners = new Map<string, Set<() => void>>();
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  constructor(private db: TeamDatabase) {}

  async start() {
    if (this.closed || this.connection) return;
    if (this.connecting) return this.connecting;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.connecting = this.connect();
    try {
      await this.connecting;
    } catch (error) {
      this.scheduleRetry();
      throw error;
    } finally {
      this.connecting = undefined;
    }
  }

  private scheduleRetry() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      // start schedules the next attempt even if the database is still offline.
      void this.start().catch(() => {});
    }, 3000);
    this.retry.unref();
  }

  private invalidate(workspaceId?: string) {
    const groups = workspaceId ? [this.listeners.get(workspaceId) ?? []] : this.listeners.values();
    for (const group of groups)
      for (const listener of group) {
        try {
          listener();
        } catch {
          /* One disconnected subscriber cannot stop the others. */
        }
      }
  }

  private async connect() {
    const client = await this.db.pool.connect();
    if (this.closed) {
      client.release();
      return;
    }
    let released = false;
    const notification = (message: Notification) => {
      if (message.channel !== 'openbranches_team_changed') return;
      try {
        this.invalidate(notice.parse(JSON.parse(message.payload ?? '')).workspaceId);
      } catch {
        /* Ignore malformed notifications, including unexpected fields. */
      }
    };
    const release = (broken = false) => {
      if (released) return;
      released = true;
      client.off('notification', notification);
      client.off('error', lost);
      client.off('end', lost);
      if (this.connection?.client === client) this.connection = undefined;
      client.release(broken);
    };
    const lost = () => {
      release(true);
      this.invalidate();
      this.scheduleRetry();
    };
    client.on('notification', notification);
    client.on('error', lost);
    client.on('end', lost);
    this.connection = { client, release };
    try {
      await client.query('LISTEN openbranches_team_changed');
      // Refresh changes committed while the listener was disconnected.
      if (!released) this.invalidate();
    } catch (error) {
      release(true);
      throw error;
    }
  }

  subscribe(workspaceId: string, listener: () => void) {
    const listeners = this.listeners.get(workspaceId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(workspaceId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(workspaceId);
    };
  }

  async close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.listeners.clear();
    await this.connecting?.catch(() => {});
    const connection = this.connection;
    if (!connection) return;
    try {
      await connection.client.query('UNLISTEN *');
      connection.release();
    } catch {
      connection.release(true);
    }
  }
}
