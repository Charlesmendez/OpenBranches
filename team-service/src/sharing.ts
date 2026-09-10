import { publishSchema, sharingChangeSchema, snapshotWithinConsent } from '../../src/team/protocol';
import { TeamDatabase } from './db';
import { changed, projectAccess, requireDevice, workspaceAccess, type Credential } from './access';
import { conflict, denied, TeamError } from './errors';
import { withdrawShares } from './withdraw';
import { projectLocalAttention } from './localAttention';

export class TeamSharing {
  constructor(private db: TeamDatabase) {}
  async state(credential: Credential, workspaceId: string) {
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const deviceId = requireDevice(principal);
      const result = await client.query(
        `SELECT project_id AS "projectId",epoch::text,sequence::text,enabled,consent,received_at AS "receivedAt"
        FROM ob_shares WHERE workspace_id=$1 AND device_id=$2 ORDER BY project_id`,
        [workspaceId, deviceId],
      );
      return result.rows.map((row) => ({
        ...row,
        epoch: Number(row.epoch),
        sequence: Number(row.sequence),
      }));
    });
  }
  async change(credential: Credential, workspaceId: string, projectId: string, input: unknown) {
    const command = sharingChangeSchema.parse(input);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const deviceId = requireDevice(principal);
      if (command.enabled) await projectAccess(client, principal, projectId, true);
      const existing = await client.query<{ epoch: string }>(
        'SELECT epoch::text FROM ob_shares WHERE workspace_id=$1 AND device_id=$2 AND project_id=$3',
        [workspaceId, deviceId, projectId],
      );
      const epoch = Number(existing.rows[0]?.epoch ?? 0);
      if (epoch !== command.expectedEpoch) throw conflict();
      if (!existing.rowCount && !command.enabled) {
        // A device may cancel an uncertain first enable after losing project
        // access. Create only its own empty disabled record, within this tenant,
        // so a late enable with the old expected epoch cannot restore sharing.
        const project = await client.query(
          'SELECT id FROM ob_projects WHERE workspace_id=$1 AND id=$2',
          [workspaceId, projectId],
        );
        if (!project.rowCount) throw denied();
      }
      const next = epoch + 1;
      const consent = command.enabled
        ? command.consent
        : { taskTitles: false, taskSummaries: false };
      await client.query(
        `INSERT INTO ob_shares(workspace_id,device_id,project_id,epoch,enabled,consent) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(workspace_id,device_id,project_id) DO UPDATE SET epoch=EXCLUDED.epoch,enabled=EXCLUDED.enabled,consent=EXCLUDED.consent,sequence=0,snapshot=NULL,attention=NULL,observed_at=NULL,received_at=NULL`,
        [workspaceId, deviceId, projectId, next, command.enabled, consent],
      );
      return {
        projectId,
        epoch: next,
        sequence: 0,
        enabled: command.enabled,
        consent,
        revision: await changed(client, workspaceId),
      };
    });
  }
  async publish(credential: Credential, workspaceId: string, projectId: string, input: unknown) {
    const command = publishSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(command.snapshot), 'utf8') > 768_000)
      throw new TeamError(
        413,
        'snapshot_too_large',
        'This shared snapshot exceeds the metadata limit.',
      );
    const observed = Date.parse(command.snapshot.observedAt);
    if (observed > Date.now() + 60_000 || observed < Date.now() - 24 * 60 * 60_000)
      throw new TeamError(
        422,
        'observation_expired',
        'Refresh the local project before sharing it.',
      );
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const deviceId = requireDevice(principal);
      await projectAccess(client, principal, projectId, true);
      const found = await client.query(
        `SELECT s.epoch::text,s.sequence::text,s.enabled,s.consent,d.expires_at AS "deviceExpiresAt"
        FROM ob_shares s JOIN ob_devices d ON d.workspace_id=s.workspace_id AND d.id=s.device_id
        WHERE s.workspace_id=$1 AND s.device_id=$2 AND s.project_id=$3`,
        [workspaceId, deviceId, projectId],
      );
      const share = found.rows[0];
      if (
        !share ||
        !share.enabled ||
        Number(share.epoch) !== command.epoch ||
        Number(share.sequence) >= command.sequence
      )
        throw conflict();
      if (!snapshotWithinConsent(command.snapshot, share.consent))
        throw new TeamError(
          422,
          'consent_mismatch',
          'The snapshot includes task text that is not enabled for sharing.',
        );
      await client.query(
        'UPDATE ob_shares SET sequence=$4,snapshot=$5,attention=$7,observed_at=$6,received_at=now() WHERE workspace_id=$1 AND device_id=$2 AND project_id=$3',
        [
          workspaceId,
          deviceId,
          projectId,
          command.sequence,
          command.snapshot,
          command.snapshot.observedAt,
          projectLocalAttention(command.snapshot, {
            workspaceId,
            projectId,
            deviceId,
            receivedAt: new Date().toISOString(),
            deviceExpiresAt: share.deviceExpiresAt.toISOString(),
          }),
        ],
      );
      await client.query('UPDATE ob_devices SET last_seen_at=now() WHERE id=$1', [deviceId]);
      return { sequence: command.sequence, revision: await changed(client, workspaceId) };
    });
  }
  async revokeDevice(credential: Credential, workspaceId: string, deviceId: string) {
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspaceId);
      const result = await client.query(
        'SELECT user_id FROM ob_devices WHERE workspace_id=$1 AND id=$2',
        [workspaceId, deviceId],
      );
      const device = result.rows[0];
      if (
        !device ||
        (principal.deviceId
          ? principal.deviceId !== deviceId
          : principal.role !== 'owner' && device.user_id !== principal.userId)
      )
        throw denied();
      await client.query(
        'UPDATE ob_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE workspace_id=$1 AND id=$2',
        [workspaceId, deviceId],
      );
      await withdrawShares(client, workspaceId, { deviceId });
      return { revision: await changed(client, workspaceId) };
    });
  }
}
