import type { PoolClient } from 'pg';
import { denied, unauthorized } from './errors';
import { secretHash, validSecret } from './secrets';

export interface Credential {
  kind: 'session' | 'device';
  token: string;
}
export interface Principal {
  userId: string;
  githubId: string;
  login: string;
  workspaceId: string;
  workspaceName: string;
  revision: string;
  role: 'owner' | 'member';
  deviceId: string | null;
}

/** All workspace mutations use the same workspace lock. Revocation, grants,
 * sharing epochs, and uploads therefore have a single committed order. */
export async function workspaceAccess(
  client: PoolClient,
  credential: Credential,
  workspaceId: string,
  lock = true,
): Promise<Principal> {
  if (!validSecret(credential.token)) throw unauthorized();
  const session = credential.kind === 'session';
  const result = await client.query<Principal>(
    `
    SELECT u.id AS "userId", u.github_id AS "githubId", u.login,
      w.id AS "workspaceId", w.name AS "workspaceName", w.revision::text,
      m.role, ${session ? 'NULL::uuid' : 'a.id'} AS "deviceId"
    FROM ob_workspaces w JOIN ob_members m ON m.workspace_id=w.id AND m.active
    JOIN ob_users u ON u.id=m.user_id
    JOIN ${session ? 'ob_sessions' : 'ob_devices'} a ON a.user_id=u.id
    WHERE w.id=$1 AND a.token_hash=$2 AND a.expires_at>now()
      ${session ? '' : 'AND a.workspace_id=w.id AND a.revoked_at IS NULL'}
    ${lock ? 'FOR UPDATE OF w' : ''}
  `,
    [workspaceId, secretHash(credential.token)],
  );
  if (!result.rows[0]) throw unauthorized();
  // Under READ COMMITTED a concurrent revocation can complete while this query
  // waits for its workspace lock. Recheck authorization after acquiring it.
  if (lock) return workspaceAccess(client, credential, workspaceId, false);
  return result.rows[0];
}
export function requireOwner(principal: Principal) {
  if (principal.role !== 'owner' || principal.deviceId) throw denied();
}
export function requireDevice(principal: Principal): string {
  if (!principal.deviceId) throw denied();
  return principal.deviceId;
}
export async function projectAccess(
  client: PoolClient,
  principal: Principal,
  projectId: string,
  share: boolean,
) {
  const result = await client.query(
    `SELECT p.id FROM ob_projects p
    LEFT JOIN ob_project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.user_id=$3
    WHERE p.workspace_id=$1 AND p.id=$2 AND p.active AND ($4::boolean OR (a.user_id IS NOT NULL AND (NOT $5::boolean OR a.can_share)))`,
    [principal.workspaceId, projectId, principal.userId, principal.role === 'owner', share],
  );
  if (!result.rows[0]) throw denied();
}
export async function changed(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ revision: string }>(
    'UPDATE ob_workspaces SET revision=revision+1 WHERE id=$1 RETURNING revision::text',
    [workspaceId],
  );
  const revision = result.rows[0].revision;
  await client.query("SELECT pg_notify('openbranches_team_changed', $1)", [
    JSON.stringify({ workspaceId, revision }),
  ]);
  return revision;
}
