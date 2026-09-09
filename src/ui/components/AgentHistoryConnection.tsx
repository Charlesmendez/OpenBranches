import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { AgentHistoryStatus } from '../../domain/types';
import { toolNames } from '../../domain/agents';
import { relativeTime } from '../../domain/branches';
import { ToolIcon } from './AgentBadges';

export function AgentHistoryConnection({ status }: { status: AgentHistoryStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = toolNames[status.tool];
  const update = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await window.openbranches?.setAgentHistoryEnabled(status.tool, enabled);
    } catch {
      setError('Could not save this connection. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-row">
        <span className="settings-icon">
          <ToolIcon tool={status.tool} />
        </span>
        <div>
          <h3>{name} sessions</h3>
          <p>Find saved sessions associated with branches in your monitored projects.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!window.openbranches || busy}
          onClick={() => void update(!status.enabled)}
        >
          {busy && <LoaderCircle size={14} className="spin" />}
          {status.enabled ? 'Disconnect ' + name : 'Connect ' + name}
        </button>
      </div>
      <div className="connection-options agent-connection-detail" aria-live="polite">
        {status.state === 'reading' && (
          <p className="muted-note">Reading saved session metadata…</p>
        )}
        {status.state === 'ready' && (
          <p className="agent-connection-count">
            {status.taskCount ?? 0} related sessions · saved history
          </p>
        )}
        {status.enabled && status.checkedAt && (
          <p className="muted-note">
            Checked {relativeTime(status.checkedAt).toLowerCase()}. Refreshes every minute.
          </p>
        )}
        {status.partial && (
          <p className="muted-note">
            This is a bounded view of available history. Some sessions or records could not be
            included.
          </p>
        )}
        <p className="muted-note">
          Reads local session files for your monitored folders. Only titles, branch and folder
          metadata, timestamps, and reported model IDs are saved. Prompts and tool output are
          discarded. No AI runs, and no data is uploaded.
        </p>
        <p className="muted-note">
          Saved folder and branch matches are possible associations. Current activity and branch
          ownership are unconfirmed.
        </p>
        {(error || status.error) && (
          <p className="connection-error" role="alert">
            {error || status.error}
          </p>
        )}
        {status.enabled && status.state === 'error' && (
          <button className="text-button" disabled={busy} onClick={() => void update(true)}>
            Try {name} again
          </button>
        )}
      </div>
    </>
  );
}
