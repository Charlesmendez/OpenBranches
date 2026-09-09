import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { CodexStatus } from '../../domain/types';
import { relativeTime } from '../../domain/branches';
import { CodexAllowance } from './CodexAllowance';
import { ToolIcon } from './AgentBadges';

export function CodexConnection({ status }: { status: CodexStatus }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await window.openbranches?.connectCodex();
    } catch {
      setError('Could not connect to Codex. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setError('');
    try {
      await window.openbranches?.disconnectCodex();
    } catch {
      setError('Could not disconnect. Try again.');
    }
  };
  return (
    <>
      <div className="settings-row">
        <span className="settings-icon">
          <ToolIcon tool="codex" />
        </span>
        <div>
          <h3>Codex tasks</h3>
          <p>
            {status.enabled
              ? 'Connect your branches to the tasks behind them, including archived work.'
              : 'Find related tasks from Codex on this Mac. Your Codex conversations stay in place.'}
          </p>
        </div>
        {status.enabled ? (
          <button className="secondary-button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={!window.openbranches || busy}
            onClick={() => void connect()}
          >
            {busy && <LoaderCircle size={14} className="spin" />} Connect Codex
          </button>
        )}
      </div>
      <div className="connection-options codex-connection-detail" aria-live="polite">
        {status.state === 'connecting' && (
          <span className="pill neutral">
            <LoaderCircle size={12} className="spin" /> Checking task history
          </span>
        )}
        {status.state === 'ready' && (
          <span className="pill blue">
            <Check size={12} /> {status.taskCount ?? 0} related{' '}
            {(status.taskCount ?? 0) === 1 ? 'task' : 'tasks'}
          </span>
        )}
        {status.state === 'ready' && status.taskCount === 0 && (
          <p className="muted-note">
            No saved tasks matched your selected branches. A task needs matching folder or
            repository metadata and branch evidence to appear.
          </p>
        )}
        {status.checkedAt && (
          <p className="muted-note">
            Task index checked {relativeTime(status.checkedAt).toLowerCase()}. Refreshes every
            minute.
          </p>
        )}
        {status.partial && (
          <p className="muted-note">
            Some history could not be included. Matches are based on the available task metadata.
          </p>
        )}
        {!status.enabled && status.version && (
          <p className="muted-note">{status.version} detected.</p>
        )}
        <p className="muted-note">
          Only task metadata for your selected projects is saved in OpenBranches. Task linking does
          not run AI or send prompts. When the local Codex daemon is available, running tasks are
          checked every 15 seconds. A running task is linked to its observed checkout; stale
          activity expires.
        </p>
        {status.enabled && (
          <p className="muted-note">
            {status.liveState === 'connected'
              ? 'Live Codex status connected on this Mac.'
              : status.liveState === 'partial'
                ? 'Some running task statuses could not be checked. Activity is shown only for confirmed matches.'
                : 'Live Codex status is unavailable. Saved task links remain available.'}
          </p>
        )}
        {(error || status.error) && (
          <p className="connection-error" role="alert">
            {error || status.error}
          </p>
        )}
        {status.enabled && status.state === 'error' && (
          <button className="text-button" disabled={busy} onClick={() => void connect()}>
            Try again
          </button>
        )}
        {status.enabled && status.account && <CodexAllowance account={status.account} />}
      </div>
    </>
  );
}
