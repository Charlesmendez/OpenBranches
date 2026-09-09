import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { TeamDatabase } from './db';
import { secret, secretHash, validSecret } from './secrets';
import { denied, unauthorized } from './errors';
import type { Credential } from './access';

export const githubIdentitySchema = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().min(1).max(200),
  type: z.literal('User'),
});
export type GitHubIdentity = z.infer<typeof githubIdentitySchema>;
export async function upsertIdentity(client: PoolClient, identity: GitHubIdentity) {
  const verified = githubIdentitySchema.parse(identity);
  const result = await client.query<{ id: string; githubId: string; login: string }>(
    `INSERT INTO ob_users(id,github_id,login) VALUES ($1,$2,$3)
    ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login RETURNING id, github_id AS "githubId", login`,
    [randomUUID(), String(verified.id), verified.login],
  );
  return result.rows[0];
}
export class TeamIdentities {
  constructor(
    private db: TeamDatabase,
    private ownerGitHubId: string,
  ) {}
  /** Called only after server-side GitHub OAuth identity verification. */
  async signIn(verifiedIdentity: GitHubIdentity) {
    return this.db.transaction(async (client) => {
      const user = await upsertIdentity(client, verifiedIdentity);
      await client.query('DELETE FROM ob_sessions WHERE expires_at<now()');
      const token = secret('obs');
      await client.query(
        "INSERT INTO ob_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '8 hours')",
        [secretHash(token), user.id],
      );
      return { token, user };
    });
  }
  async user(client: PoolClient, credential: Credential) {
    if (credential.kind !== 'session' || !validSecret(credential.token)) throw unauthorized();
    const result = await client.query<{ id: string; githubId: string; login: string }>(
      `SELECT u.id, u.github_id AS "githubId", u.login
      FROM ob_sessions s JOIN ob_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [secretHash(credential.token)],
    );
    if (!result.rows[0]) throw unauthorized();
    return result.rows[0];
  }
  async signOut(token: string) {
    await this.db.pool.query('DELETE FROM ob_sessions WHERE token_hash=$1', [secretHash(token)]);
  }
  async workspaces(credential: Credential) {
    return this.db.transaction(async (client) => {
      const user = await this.user(client, credential);
      const result = await client.query(
        `SELECT w.id,w.name,w.revision::text,m.role FROM ob_workspaces w JOIN ob_members m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.active ORDER BY w.name,w.id LIMIT 101`,
        [user.id],
      );
      return {
        user,
        canCreateWorkspace: user.githubId === this.ownerGitHubId,
        workspaces: result.rows.slice(0, 100),
        complete: result.rows.length <= 100,
      };
    });
  }
  async createWorkspace(credential: Credential, name: string) {
    const clean = z.string().trim().min(1).max(80).parse(name);
    return this.db.transaction(async (client) => {
      const user = await this.user(client, credential);
      if (user.githubId !== this.ownerGitHubId) throw denied();
      const id = randomUUID();
      await client.query('INSERT INTO ob_workspaces(id,name) VALUES ($1,$2)', [id, clean]);
      await client.query(
        "INSERT INTO ob_members(workspace_id,user_id,role) VALUES ($1,$2,'owner')",
        [id, user.id],
      );
      return { id, name: clean, revision: '0' };
    });
  }
}
