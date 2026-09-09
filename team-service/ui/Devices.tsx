import { useEffect, useState } from 'react';
import { Laptop, Plus, ShieldCheck } from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import type { TeamDevices, TeamPerson } from '../../src/team/responses';
import { dateLabel, Empty, Modal, Notice } from './primitives';
import { useAction } from './hooks';
export function Devices({
  client,
  workspace,
  people,
  onPair,
  version,
}: {
  client: TeamClient;
  workspace: string;
  people: TeamPerson[];
  onPair: () => void;
  version: string;
}) {
  const [data, setData] = useState<TeamDevices>(),
    [error, setError] = useState(''),
    [remove, setRemove] = useState<TeamDevices['devices'][number]>(),
    [reload, setReload] = useState(0),
    action = useAction();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .devices(workspace, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [client, workspace, version, reload]);
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Connected devices</h2>
          <p>See where local reports come from. Revoke a device to withdraw its shared work.</p>
        </div>
        <button className="primary" onClick={onPair}>
          <Plus size={16} />
          Connect a Mac
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading devices…</Notice>}
      {data && !data.complete && (
        <Notice>
          This device list is incomplete. Contact the team host for the remaining devices.
        </Notice>
      )}
      {data && !data.devices.length && (
        <Empty title="No devices connected yet">
          Connect a Mac to give this workspace a view of the local projects you choose to share.
        </Empty>
      )}
      <div className="device-grid">
        {data?.devices.map((device) => (
          <article className={'device-card' + (device.revokedAt ? ' revoked' : '')} key={device.id}>
            <div className="device-top">
              <span className="device-symbol">
                <Laptop size={28} />
              </span>
              <span
                className={
                  'freshness ' +
                  (device.revokedAt || Date.parse(device.expiresAt) < Date.now() ? 'stale' : '')
                }
              >
                {device.revokedAt
                  ? 'Revoked'
                  : Date.parse(device.expiresAt) < Date.now()
                    ? 'Expired'
                    : 'Paired'}
              </span>
            </div>
            <h3>{device.name}</h3>
            <p>
              @
              {people.find((person) => person.id === device.memberId)?.login ??
                'Unavailable member'}
            </p>
            <dl>
              <div>
                <dt>Last report</dt>
                <dd>{dateLabel(device.lastSeenAt)}</dd>
              </div>
              <div>
                <dt>Credential expires</dt>
                <dd>{dateLabel(device.expiresAt)}</dd>
              </div>
            </dl>
            {!device.revokedAt && (
              <button
                className="secondary danger-text"
                onClick={() => {
                  action.clear();
                  setRemove(device);
                }}
              >
                Revoke device
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="microcopy">
        <ShieldCheck size={14} /> Pairing does not enable project sharing. Device status describes
        authorization, not live activity.
      </p>
      {remove && (
        <Modal
          title="Revoke this device?"
          onClose={() => {
            if (!action.busy) setRemove(undefined);
          }}
        >
          <p>
            <strong>{remove.name}</strong> will lose access to this workspace. Its currently shared
            local snapshots will be withdrawn.
          </p>
          <Notice>
            Files and branches on the Mac are unaffected. The member can connect again with a new
            pairing.
          </Notice>
          {action.error && <Notice error>{action.error}</Notice>}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setRemove(undefined)}
            >
              Cancel
            </button>
            <button
              className="danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await client.revokeDevice(workspace, remove.id);
                  setRemove(undefined);
                  setReload((value) => value + 1);
                })
              }
            >
              {action.busy ? 'Revoking…' : 'Revoke device'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
