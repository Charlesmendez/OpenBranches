import type { PoolClient } from 'pg';
import { remoteSnapshotSchema, type RemoteSnapshot } from '../../../src/github/reader';
import { changed } from '../access';
import type { TeamDatabase } from '../db';
import type { TeamGitHubApp } from './app';
import type { InstallationBinding } from './schema';

interface SourceRow {
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  generation: string;
  installationId: string;
  accountId: string;
  accountType: 'User' | 'Organization';
  snapshot: unknown;
}

export interface GitHubSyncOptions {
  pollMilliseconds?: number;
  refreshMilliseconds?: number;
  retryMilliseconds?: number;
  concurrency?: number;
}

const lockName = (source: Pick<SourceRow, 'workspaceId' | 'projectId'>) =>
  `openbranches:github:${source.workspaceId}:${source.projectId}`;

/** Refreshes only explicitly selected repositories. Network reads run outside
 * database transactions; a generation check discards work after removal or
 * reconnection, and a session advisory lock coordinates multiple service instances. */
export class TeamGitHubSync {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private closing = false;
  private readonly pollMilliseconds: number;
  private readonly refreshMilliseconds: number;
  private readonly retryMilliseconds: number;
  private readonly concurrency: number;

  constructor(
    private db: TeamDatabase,
    private app: TeamGitHubApp,
    options: GitHubSyncOptions = {},
  ) {
    this.pollMilliseconds = Math.max(1_000, options.pollMilliseconds ?? 5_000);
    this.refreshMilliseconds = Math.max(60_000, options.refreshMilliseconds ?? 15 * 60_000);
    this.retryMilliseconds = Math.max(30_000, options.retryMilliseconds ?? 5 * 60_000);
    this.concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
  }

  start() {
    if (this.timer || this.closing) return;
    void this.refresh().catch(() => {});
    this.timer = setInterval(() => void this.refresh().catch(() => {}), this.pollMilliseconds);
    this.timer.unref?.();
  }

  /** Public for deterministic service tests and a future owner refresh action. */
  refresh(force = false) {
    if (this.closing) return Promise.resolve();
    if (this.active) return this.active;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.active = this.run(force, signal).finally(() => {
      this.active = undefined;
      this.controller = undefined;
    });
    return this.active;
  }

  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active?.catch(() => {});
  }

  private async run(force: boolean, signal: AbortSignal) {
    const result = await this.db.pool.query<SourceRow>(
      `SELECT s.workspace_id AS "workspaceId",s.project_id AS "projectId",p.github_id AS "repositoryId",s.generation,
      s.installation_id AS "installationId",s.account_id AS "accountId",s.account_type AS "accountType",s.snapshot
      FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
      WHERE $1::boolean OR s.checked_at IS NULL
        OR (s.last_error AND s.checked_at<now()-($2::integer * interval '1 millisecond'))
        OR (NOT s.last_error AND s.checked_at<now()-($3::integer * interval '1 millisecond'))
      ORDER BY s.checked_at NULLS FIRST,s.selected_at,s.workspace_id,s.project_id LIMIT $4`,
      [force, this.retryMilliseconds, this.refreshMilliseconds, Math.max(8, this.concurrency * 4)],
    );
    let index = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const source = result.rows[index++];
        if (!source) return;
        await this.refreshSource(source, signal, force);
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));
  }

  private async refreshSource(source: SourceRow, signal: AbortSignal, force: boolean) {
    const client = await this.db.pool.connect();
    const key = lockName(source);
    let locked = false;
    try {
      const acquired = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
        [key],
      );
      locked = acquired.rows[0]?.locked === true;
      if (!locked || signal.aborted) return;
      const current = await this.current(client, source, force);
      if (!current) return;
      const parsed = remoteSnapshotSchema.safeParse(current.snapshot);
      const previous = parsed.success
        ? { repositoryId: current.repositoryId, snapshot: parsed.data }
        : undefined;
      try {
        const result = await this.app.read(this.binding(current), current.repositoryId, {
          signal,
          isCurrent: () => !signal.aborted,
          ...(previous ? { previous } : {}),
        });
        if (signal.aborted) return;
        await this.save(current, result.project.fullName, result.snapshot);
      } catch {
        if (!signal.aborted) await this.fail(current, parsed.success);
      }
    } finally {
      if (locked)
        await client
          .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key])
          .catch(() => {});
      client.release();
    }
  }

  private binding(source: SourceRow): InstallationBinding {
    return {
      installationId: source.installationId,
      accountId: source.accountId,
      accountType: source.accountType,
    };
  }

  private async current(client: PoolClient, source: SourceRow, force: boolean) {
    const result = await client.query<SourceRow>(
      `SELECT s.workspace_id AS "workspaceId",s.project_id AS "projectId",p.github_id AS "repositoryId",s.generation,
      s.installation_id AS "installationId",s.account_id AS "accountId",s.account_type AS "accountType",s.snapshot
      FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
      WHERE s.workspace_id=$1 AND s.project_id=$2 AND s.generation=$3 AND ($4::boolean OR s.checked_at IS NULL
        OR (s.last_error AND s.checked_at<now()-($5::integer * interval '1 millisecond'))
        OR (NOT s.last_error AND s.checked_at<now()-($6::integer * interval '1 millisecond')))`,
      [
        source.workspaceId,
        source.projectId,
        source.generation,
        force,
        this.retryMilliseconds,
        this.refreshMilliseconds,
      ],
    );
    return result.rows[0];
  }

  private async save(source: SourceRow, fullName: string, snapshot: RemoteSnapshot) {
    await this.db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE ob_github_sources SET snapshot=$5,checked_at=now(),last_error=false
        WHERE workspace_id=$1 AND project_id=$2 AND generation=$3 AND installation_id=$4 RETURNING project_id`,
        [
          source.workspaceId,
          source.projectId,
          source.generation,
          source.installationId,
          JSON.stringify(remoteSnapshotSchema.parse(snapshot)),
        ],
      );
      if (!result.rowCount) return;
      await client.query(
        'UPDATE ob_projects SET name=$3,github_slug=$3 WHERE workspace_id=$1 AND id=$2 AND github_id=$4',
        [source.workspaceId, source.projectId, fullName, source.repositoryId],
      );
      await changed(client, source.workspaceId);
    });
  }

  private async fail(source: SourceRow, keepSnapshot: boolean) {
    await this.db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE ob_github_sources SET checked_at=now(),last_error=true,snapshot=CASE WHEN $5::boolean THEN snapshot ELSE NULL END
        WHERE workspace_id=$1 AND project_id=$2 AND generation=$3 AND installation_id=$4 RETURNING project_id`,
        [
          source.workspaceId,
          source.projectId,
          source.generation,
          source.installationId,
          keepSnapshot,
        ],
      );
      if (result.rowCount) await changed(client, source.workspaceId);
    });
  }
}
