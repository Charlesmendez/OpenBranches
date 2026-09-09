import type { PoolClient } from 'pg';

interface ShareScope {
  deviceId?: string;
  memberId?: string;
  projectId?: string;
}

/** The caller holds the workspace lock and has authorized this scope. Every
 * withdrawal clears both the snapshot and consent, and invalidates old uploads. */
export async function withdrawShares(client: PoolClient, workspaceId: string, scope: ShareScope) {
  if (!scope.deviceId && !scope.memberId && !scope.projectId)
    throw new Error('A withdrawal scope is required.');
  await client.query(
    `UPDATE ob_shares s
    SET enabled=false,epoch=epoch+1,sequence=0,consent='{"taskTitles":false,"taskSummaries":false}'::jsonb,
      snapshot=NULL,observed_at=NULL,received_at=NULL
    FROM ob_devices d WHERE s.device_id=d.id AND s.workspace_id=d.workspace_id AND s.workspace_id=$1
      AND ($2::uuid IS NULL OR s.device_id=$2) AND ($3::uuid IS NULL OR d.user_id=$3)
      AND ($4::uuid IS NULL OR s.project_id=$4)`,
    [workspaceId, scope.deviceId ?? null, scope.memberId ?? null, scope.projectId ?? null],
  );
}
