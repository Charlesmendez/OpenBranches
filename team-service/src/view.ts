import { z } from 'zod';
import { sharedSnapshotSchema, teamId, type TeamView } from '../../src/team/protocol';
import { TeamDatabase } from './db';
import { workspaceAccess, type Credential } from './access';
const pageSchema = z.object({
  projectId: teamId.optional(),
  memberId: teamId.optional(),
  after: z.tuple([teamId, teamId]).optional(),
});

export class TeamViews {
  constructor(private db: TeamDatabase) {}
  async view(
    credential: Credential,
    workspaceId: string,
    options: unknown = {},
  ): Promise<TeamView & { nextCursor: string | null }> {
    const page = pageSchema.parse(options);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const people = await client.query(
        `SELECT u.id,u.github_id AS "githubId",u.login,m.role FROM ob_members m JOIN ob_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active ORDER BY u.login,u.id LIMIT 1001`,
        [workspaceId],
      );
      const projects = await client.query(
        `SELECT p.id,p.name,p.github_id AS "githubId",p.github_slug AS "githubSlug",($3::boolean OR a.can_share) AS "canShare"
        FROM ob_projects p LEFT JOIN ob_project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.user_id=$2
        WHERE p.workspace_id=$1 AND p.active AND ($3::boolean OR a.user_id IS NOT NULL) ORDER BY p.name,p.id LIMIT 1001`,
        [workspaceId, principal.userId, principal.role === 'owner'],
      );
      const rows = await client.query(
        `SELECT s.project_id AS "projectId",d.id AS "deviceId",d.user_id AS "memberId",d.name AS "deviceName",d.expires_at AS "deviceExpiresAt",s.epoch::text,s.sequence::text,s.received_at AS "receivedAt",s.snapshot
        FROM ob_shares s JOIN ob_devices d ON d.id=s.device_id AND d.workspace_id=s.workspace_id
        JOIN ob_members m ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.active
        JOIN ob_projects p ON p.id=s.project_id AND p.workspace_id=s.workspace_id AND p.active
        LEFT JOIN ob_project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.user_id=$2
        WHERE s.workspace_id=$1 AND s.enabled AND s.snapshot IS NOT NULL AND d.revoked_at IS NULL
          AND ($3::boolean OR a.user_id IS NOT NULL) AND ($4::uuid IS NULL OR p.id=$4) AND ($5::uuid IS NULL OR d.user_id=$5)
          AND ($6::uuid IS NULL OR (d.id,p.id)>($6::uuid,$7::uuid)) ORDER BY d.id,p.id LIMIT 11`,
        [
          workspaceId,
          principal.userId,
          principal.role === 'owner',
          page.projectId ?? null,
          page.memberId ?? null,
          page.after?.[0] ?? null,
          page.after?.[1] ?? null,
        ],
      );
      const selected = rows.rows.slice(0, 10);
      const last = selected.at(-1);
      return {
        workspace: { id: workspaceId, name: principal.workspaceName, revision: principal.revision },
        people: people.rows.slice(0, 1000),
        projects: projects.rows.slice(0, 1000),
        coverage: { people: people.rows.length <= 1000, projects: projects.rows.length <= 1000 },
        work: selected.map((row) => ({
          ...row,
          epoch: Number(row.epoch),
          sequence: Number(row.sequence),
          receivedAt: row.receivedAt.toISOString(),
          deviceExpiresAt: row.deviceExpiresAt.toISOString(),
          snapshot: sharedSnapshotSchema.parse(row.snapshot),
        })),
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
}
