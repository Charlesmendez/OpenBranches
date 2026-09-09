import { useState } from 'react';
import { Check, Laptop, ArrowRight } from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import { Modal, Notice } from './primitives';
import { useAction } from './hooks';
export function PairDevice({
  client,
  workspace,
  team,
  login,
  onClose,
  onDone,
}: {
  client: TeamClient;
  workspace: string;
  team: string;
  login: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(''),
    [device, setDevice] = useState(''),
    [done, setDone] = useState(false),
    action = useAction();
  const formatted =
    code
      .replace(/[^A-Z2-9]/gi, '')
      .toUpperCase()
      .slice(0, 12)
      .match(/.{1,4}/g)
      ?.join('-') ?? '';
  return (
    <Modal
      title={done ? 'Mac connected' : 'Connect your Mac'}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      {done ? (
        <>
          <div className="pair-symbol">
            <Check size={32} />
          </div>
          <p>
            <strong>{device}</strong> is connected to {team} as @{login}.
          </p>
          <Notice>
            Choose projects and review what you share in the Mac app. Connecting a device shares no
            projects by itself.
          </Notice>
          <button className="primary wide" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <>
          <div className="pair-symbol">
            <Laptop size={32} />
          </div>
          {!device ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async () => {
                  const result = await client.inspectPair(workspace, formatted);
                  setDevice(result.deviceName);
                });
              }}
            >
              <p>Enter the code shown by OpenBranches on your Mac.</p>
              <label className="field">
                Connection code
                <input
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Connection code"
                  className="pair-code"
                  placeholder="ABCD · EFGH · JKLM"
                  value={formatted}
                  onChange={(event) => setCode(event.target.value)}
                  maxLength={14}
                />
              </label>
              <p className="muted">
                You are connecting to <strong>{team}</strong> as @{login}.
              </p>
              {action.error && <Notice error>{action.error}</Notice>}
              <button className="primary wide" disabled={action.busy || formatted.length !== 14}>
                {action.busy ? 'Checking…' : 'Review connection'}
                <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <>
              <p>
                Connect <strong>{device}</strong> to <strong>{team}</strong>?
              </p>
              <Notice>
                This device will use your account, @{login}. Project access follows your team
                permissions. Local sharing remains off until you choose it on the Mac.
              </Notice>
              {action.error && <Notice error>{action.error}</Notice>}
              <div className="dialog-actions">
                <button
                  className="secondary"
                  disabled={action.busy}
                  onClick={() => {
                    setDevice('');
                    action.clear();
                  }}
                >
                  Change code
                </button>
                <button
                  className="primary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await client.approvePair(workspace, formatted);
                      setDone(true);
                      onDone();
                    })
                  }
                >
                  {action.busy ? 'Connecting…' : 'Connect Mac'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
