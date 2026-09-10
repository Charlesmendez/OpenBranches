import { z } from 'zod';
import { teamId } from '../../src/team/protocol';
import { sharedWorkSchema, type SharedWork, type TeamPage } from '../../src/team/responses';
import { denied } from './errors';
import { TeamDatabase } from './db';
import {
  requireOwner,
  requireDevice,
  workspaceAccess,
  type Credential,
  type Principal,
} from './access';
import type { PoolClient } from 'pg';
import type { Companion } from '../../src/team/device';
import { visibleShares, searchPattern } from './visible';
const pageSchema = z.object({
  projectId: teamId.optional(),
  memberId: teamId.optional(),
  after: z.tuple([teamId, teamId]).optional(),
  query: z.string().max(160).optional(),
});
const LIVE_LIMIT = 24;
const visibleProjects = (client: PoolClient, principal: Principal) =>
  client.query(
    `SELECT p.id,p.name,p.github_id AS "githubId",p.github_slug AS "githubSlug",($3::boolean OR a.can_share) AS "canShare"
  FROM ob_projects p LEFT JOIN ob_project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.user_id=$2
  WHERE p.workspace_id=$1 AND p.active AND ($3::boolean OR a.user_id IS NOT NULL) ORDER BY p.name,p.id LIMIT 1001`,
    [principal.workspaceId, principal.userId, principal.role === 'owner'],
  );

export class TeamViews {
  constructor(private db: TeamDatabase) {}
  async view(
    credential: Credential,
    workspaceId: string,
    options: unknown = {},
  ): Promise<TeamPage> {
    const page = pageSchema.parse(options);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const people = await client.query(
        `SELECT u.id,u.github_id AS "githubId",u.login,m.role FROM ob_members m JOIN ob_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active ORDER BY u.login,u.id LIMIT 1001`,
        [workspaceId],
      );
      const projects = await visibleProjects(client, principal);
      const params = [
        workspaceId,
        principal.userId,
        principal.role === 'owner',
        page.projectId ?? null,
        page.memberId ?? null,
        searchPattern(page.query),
      ];
      const totals = await client.query(
        `SELECT count(DISTINCT d.user_id)::integer AS people,count(DISTINCT p.id)::integer AS projects,
        COALESCE(sum(jsonb_array_length(matched.branches)),0)::bigint::text AS reports,count(*)::integer AS snapshots,
        count(*) FILTER (WHERE d.expires_at<=now() OR s.observed_at<now()-interval '5 minutes' OR s.received_at<now()-interval '5 minutes' OR s.observed_at>now()+interval '1 minute' OR (s.snapshot->>'sourceError')::boolean)::integer AS stale,
        COALESCE(sum((s.snapshot->>'omittedBranches')::integer),0)::bigint::text AS omitted ${visibleShares}`,
        params,
      );
      const rows = await client.query(
        `SELECT s.project_id AS "projectId",d.id AS "deviceId",d.user_id AS "memberId",d.name AS "deviceName",d.expires_at AS "deviceExpiresAt",s.epoch::text,s.sequence::text,s.received_at AS "receivedAt",jsonb_set(s.snapshot,'{branches}',matched.branches) AS snapshot
        ${visibleShares} AND ($7::uuid IS NULL OR (d.id,p.id)>($7::uuid,$8::uuid)) ORDER BY d.id,p.id LIMIT 11`,
        [...params, page.after?.[0] ?? null, page.after?.[1] ?? null],
      );
      const liveRows = await client.query(
        `WITH visible AS (
          SELECT s.project_id AS "projectId",d.id AS "deviceId",d.user_id AS "memberId",
            d.name AS "deviceName",d.expires_at AS "deviceExpiresAt",s.epoch::text,
            s.sequence::text,s.received_at AS "receivedAt",s.observed_at AS "observedAt",
            s.snapshot,matched.branches ${visibleShares}
        ), live_branches AS (
          SELECT visible.*,branch.value AS branch,activity.waiting,activity."checkedAt"
          FROM visible CROSS JOIN LATERAL jsonb_array_elements(visible.branches) branch(value)
          CROSS JOIN LATERAL (
            SELECT bool_or(COALESCE((task.value->>'waiting')::boolean,false)) AS waiting,
              max((task.value->>'checkedAt')::timestamptz) AS "checkedAt"
            FROM jsonb_array_elements(branch.value->'tasks') task(value)
            WHERE task.value->>'association'='verified' AND task.value ? 'activitySource'
              AND (COALESCE((task.value->>'waiting')::boolean,false)
                OR task.value->>'status'='active')
              AND (task.value->>'checkedAt')::timestamptz>=now()-interval '90 seconds'
              AND (task.value->>'checkedAt')::timestamptz<=now()+interval '1 minute'
          ) activity
          WHERE activity."checkedAt" IS NOT NULL
            AND NOT (visible.snapshot->>'sourceError')::boolean
            AND visible."deviceExpiresAt">now()
            AND visible."receivedAt">=now()-interval '5 minutes'
            AND visible."receivedAt"<=now()+interval '1 minute'
            AND visible."observedAt">=now()-interval '5 minutes'
            AND visible."observedAt"<=now()+interval '1 minute'
        )
        SELECT "projectId","deviceId","memberId","deviceName","deviceExpiresAt",epoch,sequence,
          "receivedAt",jsonb_set(snapshot,'{branches}',jsonb_build_array(branch)) AS snapshot,
          count(*) OVER()::integer AS "liveTotal"
        FROM live_branches
        ORDER BY waiting,"checkedAt" DESC,"deviceId","projectId",branch->>'key'
        LIMIT ${LIVE_LIMIT + 1}`,
        params,
      );
      const selected = rows.rows.slice(0, 10);
      const selectedLive = liveRows.rows.slice(0, LIVE_LIMIT);
      const last = selected.at(-1);
      return {
        workspace: { id: workspaceId, name: principal.workspaceName, revision: principal.revision },
        people: people.rows.slice(0, 1000),
        projects: projects.rows.slice(0, 1000),
        coverage: { people: people.rows.length <= 1000, projects: projects.rows.length <= 1000 },
        work: selected.map(sharedWork),
        live: {
          work: selectedLive.map(sharedWork),
          total: Number(liveRows.rows[0]?.liveTotal ?? 0),
          complete: liveRows.rows.length <= LIVE_LIMIT,
        },
        totals: {
          ...totals.rows[0],
          reports: Number(totals.rows[0].reports),
          omitted: Number(totals.rows[0].omitted),
        },
        checkedAt: new Date().toISOString(),
        nextCursor: rows.rows.length > 10 && last ? `${last.deviceId}:${last.projectId}` : null,
      };
    });
  }
  async devices(credential: Credential, workspaceId: string) {
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const result = await client.query(
        `SELECT id,user_id AS "memberId",name,expires_at AS "expiresAt",revoked_at AS "revokedAt",last_seen_at AS "lastSeenAt"
        FROM ob_devices WHERE workspace_id=$1 AND ($2::boolean OR user_id=$3) ORDER BY created_at DESC LIMIT 1001`,
        [workspaceId, principal.role === 'owner' && !principal.deviceId, principal.userId],
      );
      return { devices: result.rows.slice(0, 1000), complete: result.rows.length <= 1000 };
    });
  }
  async companion(credential: Credential, workspaceId: string): Promise<Companion> {
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const deviceId = requireDevice(principal);
      const projects = await visibleProjects(client, principal);
      const device = await client.query(
        'SELECT id,name,expires_at AS "expiresAt" FROM ob_devices WHERE id=$1 AND workspace_id=$2',
        [deviceId, workspaceId],
      );
      const shares = await client.query(
        `SELECT project_id AS "projectId",epoch::text,sequence::text,enabled,consent,received_at AS "receivedAt"
        FROM ob_shares WHERE workspace_id=$1 AND device_id=$2 ORDER BY project_id LIMIT 1001`,
        [workspaceId, deviceId],
      );
      return {
        workspace: { id: workspaceId, name: principal.workspaceName, revision: principal.revision },
        member: { id: principal.userId, login: principal.login },
        device: { ...device.rows[0], expiresAt: device.rows[0].expiresAt.toISOString() },
        projects: projects.rows.slice(0, 1000),
        shares: shares.rows.slice(0, 1000).map((row) => ({
          ...row,
          epoch: Number(row.epoch),
          sequence: Number(row.sequence),
          receivedAt: row.receivedAt?.toISOString() ?? null,
        })),
        complete: { projects: projects.rows.length <= 1000, shares: shares.rows.length <= 1000 },
      };
    });
  }
  async projectAccess(credential: Credential, workspaceId: string, projectId: string) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const project = await client.query(
        'SELECT id FROM ob_projects WHERE workspace_id=$1 AND id=$2 AND active',
        [workspaceId, projectId],
      );
      if (!project.rowCount) throw denied();
      const result = await client.query(
        `SELECT m.user_id AS "memberId",(a.user_id IS NOT NULL) AS enabled,COALESCE(a.can_share,false) AS "canShare"
        FROM ob_members m LEFT JOIN ob_project_access a ON a.workspace_id=m.workspace_id AND a.user_id=m.user_id AND a.project_id=$2
        WHERE m.workspace_id=$1 AND m.active AND m.role='member' ORDER BY m.user_id LIMIT 1001`,
        [workspaceId, projectId],
      );
      return { members: result.rows.slice(0, 1000), complete: result.rows.length <= 1000 };
    });
  }
}

function sharedWork(row: Record<string, unknown>): SharedWork {
  return sharedWorkSchema.parse({
    projectId: row.projectId,
    deviceId: row.deviceId,
    memberId: row.memberId,
    deviceName: row.deviceName,
    deviceExpiresAt: timestamp(row.deviceExpiresAt),
    epoch: Number(row.epoch),
    sequence: Number(row.sequence),
    receivedAt: timestamp(row.receivedAt),
    snapshot: row.snapshot,
  });
}

function timestamp(value: unknown) {
  if (!(value instanceof Date)) throw new Error('The database returned an invalid timestamp.');
  return value.toISOString();
}
