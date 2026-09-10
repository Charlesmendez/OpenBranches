import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TeamDatabase } from './db';
import { changed, requireOwner, workspaceAccess, type Credential } from './access';
import { upsertIdentity, type GitHubIdentity } from './identities';
import { denied } from './errors';
import { withdrawShares } from './withdraw';

export class TeamMembers {
  constructor(private db: TeamDatabase) {}
  async add(credential: Credential, workspaceId: string, identity: GitHubIdentity) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const user = await upsertIdentity(client, identity);
      await client.query(
        `INSERT INTO ob_members(workspace_id,user_id,role) VALUES ($1,$2,'member')
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true`,
        [workspaceId, user.id],
      );
      await changed(client, workspaceId);
      return user;
    });
  }
  async remove(credential: Credential, workspaceId: string, userId: string) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const member = await client.query(
        "UPDATE ob_members SET active=false WHERE workspace_id=$1 AND user_id=$2 AND role='member' RETURNING user_id",
        [workspaceId, userId],
      );
      if (!member.rowCount) throw denied();
      await client.query(
        'UPDATE ob_devices SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [workspaceId, userId],
      );
      await withdrawShares(client, workspaceId, { memberId: userId });
      await client.query('DELETE FROM ob_project_access WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        userId,
      ]);
      return { revision: await changed(client, workspaceId) };
    });
  }
  /** Team-issued identity for repositories without a GitHub provider identity. */
  async createProject(credential: Credential, workspaceId: string, name: string) {
    const clean = z.string().trim().min(1).max(120).parse(name);
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const id = randomUUID();
      await client.query('INSERT INTO ob_projects(id,workspace_id,name) VALUES ($1,$2,$3)', [
        id,
        workspaceId,
        clean,
      ]);
      await changed(client, workspaceId);
      return { id, name: clean, githubId: null, githubSlug: null };
    });
  }
  async grant(
    credential: Credential,
    workspaceId: string,
    projectId: string,
    userId: string,
    enabled: boolean,
    canShare: boolean,
  ) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const allowed = await client.query(
        `SELECT p.id FROM ob_projects p JOIN ob_members m ON m.workspace_id=p.workspace_id
        WHERE p.id=$2 AND p.workspace_id=$1 AND p.active AND m.user_id=$3 AND m.active AND m.role='member'`,
        [workspaceId, projectId, userId],
      );
      if (!allowed.rowCount) throw denied();
      if (enabled)
        await client.query(
          `INSERT INTO ob_project_access(workspace_id,project_id,user_id,can_share) VALUES ($1,$2,$3,$4)
        ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET can_share=EXCLUDED.can_share`,
          [workspaceId, projectId, userId, canShare],
        );
      else
        await client.query(
          'DELETE FROM ob_project_access WHERE workspace_id=$1 AND project_id=$2 AND user_id=$3',
          [workspaceId, projectId, userId],
        );
      if (!enabled || !canShare)
        await withdrawShares(client, workspaceId, { memberId: userId, projectId });
      return { revision: await changed(client, workspaceId) };
    });
  }
  async removeProject(credential: Credential, workspaceId: string, projectId: string) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspaceId));
      const result = await client.query(
        'UPDATE ob_projects SET active=false WHERE workspace_id=$1 AND id=$2 RETURNING id',
        [workspaceId, projectId],
      );
      if (!result.rowCount) throw denied();
      await withdrawShares(client, workspaceId, { projectId });
      await client.query('DELETE FROM ob_github_sources WHERE workspace_id=$1 AND project_id=$2', [
        workspaceId,
        projectId,
      ]);
      await client.query('DELETE FROM ob_github_reviews WHERE workspace_id=$1', [workspaceId]);
      await client.query('DELETE FROM ob_project_access WHERE workspace_id=$1 AND project_id=$2', [
        workspaceId,
        projectId,
      ]);
      return { revision: await changed(client, workspaceId) };
    });
  }
}
