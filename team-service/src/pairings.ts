import { randomUUID } from 'node:crypto';
import { pairingApprovalSchema, pairingStartSchema } from '../../src/team/protocol';
import { TeamDatabase } from './db';
import { changed, workspaceAccess, type Credential } from './access';
import { denied, TeamError, unauthorized } from './errors';
import { pairingCode, secret, secretHash, validSecret } from './secrets';
import { withdrawShares } from './withdraw';

export class TeamPairings {
  constructor(private db: TeamDatabase) {}
  async start(input: unknown) {
    const { deviceName } = pairingStartSchema.parse(input);
    const token = secret('obd');
    const userCode = pairingCode();
    await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(826041921)');
      await client.query("DELETE FROM ob_pairings WHERE expires_at < now()-interval '1 day'");
      const pending = await client.query<{ count: string }>(
        'SELECT count(*)::text FROM ob_pairings WHERE expires_at>now() AND device_id IS NULL AND NOT cancelled',
      );
      if (Number(pending.rows[0].count) >= 1000)
        throw new TeamError(429, 'pairing_busy', 'Too many pending pairings. Try again later.');
      await client.query(
        "INSERT INTO ob_pairings(secret_hash,code_hash,device_name,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')",
        [secretHash(token), secretHash(userCode), deviceName],
      );
    });
    // This secret becomes the scoped device credential only after the person
    // approves the displayed code in an authenticated browser session.
    return { pairingSecret: token, userCode, expiresIn: 600, interval: 5 };
  }
  async inspect(credential: Credential, workspaceId: string, code: string) {
    if (credential.kind !== 'session') throw denied();
    const input = pairingApprovalSchema.parse({ workspaceId, userCode: code });
    return this.db.transaction(async (client) => {
      await workspaceAccess(client, credential, workspaceId);
      const row = await client.query(
        'SELECT device_name AS "deviceName" FROM ob_pairings WHERE code_hash=$1 AND expires_at>now() AND NOT cancelled AND device_id IS NULL',
        [secretHash(input.userCode)],
      );
      if (!row.rows[0])
        throw new TeamError(
          404,
          'pairing_unavailable',
          'This pairing code is unavailable or expired.',
        );
      return row.rows[0] as { deviceName: string };
    });
  }
  async approve(credential: Credential, input: unknown) {
    if (credential.kind !== 'session') throw denied();
    const { workspaceId, userCode } = pairingApprovalSchema.parse(input);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const result = await client.query<{ secret_hash: string; device_name: string }>(
        `SELECT secret_hash,device_name FROM ob_pairings
        WHERE code_hash=$1 AND expires_at>now() AND NOT cancelled AND device_id IS NULL FOR UPDATE`,
        [secretHash(userCode)],
      );
      const pairing = result.rows[0];
      if (!pairing)
        throw new TeamError(
          409,
          'pairing_unavailable',
          'This pairing code is unavailable or expired.',
        );
      const id = randomUUID();
      await client.query(
        "INSERT INTO ob_devices(id,workspace_id,user_id,name,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '90 days')",
        [id, workspaceId, principal.userId, pairing.device_name, pairing.secret_hash],
      );
      await client.query('UPDATE ob_pairings SET device_id=$1 WHERE secret_hash=$2', [
        id,
        pairing.secret_hash,
      ]);
      await changed(client, workspaceId);
      return {
        deviceId: id,
        workspaceId,
        memberId: principal.userId,
        deviceName: pairing.device_name,
      };
    });
  }
  async poll(token: string) {
    if (!validSecret(token)) throw unauthorized();
    return this.db.transaction(async (client) => {
      const result = await client.query<{
        device_id: string | null;
        cancelled: boolean;
        expired: boolean;
        slow: boolean;
      }>(
        `SELECT device_id,cancelled,expires_at<=now() AS expired,
        last_poll_at>now()-interval '5 seconds' AS slow FROM ob_pairings WHERE secret_hash=$1 FOR UPDATE`,
        [secretHash(token)],
      );
      const pairing = result.rows[0];
      if (!pairing || pairing.cancelled || pairing.expired)
        throw new TeamError(410, 'pairing_expired', 'The pairing expired or was cancelled.');
      if (pairing.slow)
        throw new TeamError(429, 'slow_down', 'Wait five seconds before checking pairing again.');
      await client.query('UPDATE ob_pairings SET last_poll_at=now() WHERE secret_hash=$1', [
        secretHash(token),
      ]);
      if (!pairing.device_id) return { state: 'pending' as const };
      const paired = await client.query(
        `SELECT d.id AS "deviceId",d.workspace_id AS "workspaceId",d.user_id AS "memberId",d.name AS "deviceName",d.expires_at AS "expiresAt",u.login,w.name AS "workspaceName"
        FROM ob_devices d JOIN ob_members m ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.active
        JOIN ob_users u ON u.id=d.user_id JOIN ob_workspaces w ON w.id=d.workspace_id
        WHERE d.id=$1 AND d.revoked_at IS NULL AND d.expires_at>now()`,
        [pairing.device_id],
      );
      if (!paired.rows[0]) throw unauthorized();
      return { state: 'paired' as const, ...paired.rows[0] };
    });
  }
  async cancel(token: string) {
    if (!validSecret(token)) throw unauthorized();
    // Resolve a possible workspace before locking the pairing row, maintaining
    // the workspace → pairing lock order used by approval.
    const lookup = await this.db.pool.query<{ workspace_id: string }>(
      `SELECT d.workspace_id FROM ob_pairings p JOIN ob_devices d ON d.id=p.device_id WHERE p.secret_hash=$1`,
      [secretHash(token)],
    );
    return this.db.transaction(async (client) => {
      if (lookup.rows[0])
        await client.query('SELECT id FROM ob_workspaces WHERE id=$1 FOR UPDATE', [
          lookup.rows[0].workspace_id,
        ]);
      const row = await client.query<{ device_id: string | null }>(
        'SELECT device_id FROM ob_pairings WHERE secret_hash=$1 FOR UPDATE',
        [secretHash(token)],
      );
      if (!row.rows[0]) return;
      // Approval may have won after the initial lookup. Retry with a workspace
      // lock instead of taking locks in the reverse order.
      if (row.rows[0].device_id && !lookup.rows[0])
        throw new TeamError(
          409,
          'pairing_changed',
          'Pairing completed while cancelling. Retry cancellation.',
        );
      await client.query('UPDATE ob_pairings SET cancelled=true WHERE secret_hash=$1', [
        secretHash(token),
      ]);
      if (row.rows[0].device_id) {
        await client.query(
          'UPDATE ob_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',
          [row.rows[0].device_id],
        );
        await withdrawShares(client, lookup.rows[0].workspace_id, {
          deviceId: row.rows[0].device_id,
        });
        await changed(client, lookup.rows[0].workspace_id);
      }
    });
  }
}
