import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Radio, ShieldCheck } from 'lucide-react';
import type { AgentLiveStatus, LiveAgentTool } from '../../domain/types';
import { toolNames } from '../../domain/agents';
import { relativeTime } from '../../domain/branches';
import { ToolIcon } from './AgentBadges';

const supported: LiveAgentTool[] = ['codex', 'claude-code', 'cursor'];

export function AgentLiveConnections({
  statuses,
  focusOnMount = false,
}: {
  statuses?: AgentLiveStatus[];
  focusOnMount?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<LiveAgentTool>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => {
      container.current?.scrollIntoView({ block: 'start' });
      container.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  const values = supported.map(
    (tool) =>
      statuses?.find((status) => status.tool === tool) ?? {
        tool,
        enabled: false,
        installed: false,
        state: 'not-connected' as const,
        activeCount: 0,
      },
  );
  const update = async (tool: LiveAgentTool, enabled: boolean) => {
    if (busy) return;
    setBusy(tool);
    setError('');
    try {
      await window.openbranches?.setAgentLiveEnabled(tool, enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update live activity.');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div
      ref={container}
      className={`agent-live-connections ${focusOnMount ? 'focused' : ''}`}
      tabIndex={-1}
    >
      <div className="settings-row agent-live-heading">
        <span className="settings-icon live-listener-icon">
          <Radio size={20} />
        </span>
        <div>
          <h3>Live coding activity</h3>
          <p>
            Make the exact branch glow while Codex, Claude Code, or Cursor is working in its current
            checkout. Each tool is opt-in on this Mac.
          </p>
        </div>
        <span className="pill neutral">
          <ShieldCheck size={12} /> On this Mac
        </span>
      </div>
      <div className="agent-live-grid">
        {values.map((status) => {
          const name = toolNames[status.tool];
          const repair = status.enabled && !status.installed;
          return (
            <article
              className={`agent-live-card ${status.enabled ? 'connected' : ''}`}
              key={status.tool}
            >
              <div className="agent-live-card-title">
                <span className="agent-live-tool-icon">
                  <ToolIcon tool={status.tool} />
                </span>
                <div>
                  <h4>{name}</h4>
                  <span className={`agent-live-state ${status.state}`}>
                    <i aria-hidden="true" />
                    {status.state === 'listening'
                      ? status.activeCount
                        ? `${status.activeCount} ${status.activeCount === 1 ? 'session' : 'sessions'} live`
                        : 'Listening'
                      : status.state === 'error'
                        ? 'Needs setup'
                        : 'Off'}
                  </span>
                </div>
              </div>
              <p>
                {status.enabled
                  ? status.receivedAt
                    ? `Last signal ${relativeTime(status.receivedAt).toLowerCase()}.`
                    : status.tool === 'codex'
                      ? 'Hook installed. Codex may ask you to review it; then start a new turn in the checkout.'
                      : `Ready. Start work in ${name} to see the branch appear in Happening now.`
                  : `Add a private local hook to ${name}. Existing hook settings are preserved.`}
              </p>
              <div className="agent-live-card-action">
                <button
                  className={status.enabled && !repair ? 'text-button' : 'secondary-button'}
                  disabled={!window.openbranches || !!busy}
                  onClick={() => void update(status.tool, repair ? true : !status.enabled)}
                >
                  {busy === status.tool && <LoaderCircle size={14} className="spin" />}
                  {repair
                    ? `Repair ${name}`
                    : status.enabled
                      ? `Turn off ${name}`
                      : `Enable ${name}`}
                </button>
                {status.enabled && status.installed && (
                  <span className="agent-hook-installed">
                    <Check size={12} /> Hook installed
                  </span>
                )}
              </div>
              {status.error && <p className="agent-live-error">{status.error}</p>}
            </article>
          );
        })}
      </div>
      <p className="agent-live-privacy">
        OpenBranches keeps only tool, session ID, model ID, workspace folder, state, and receipt
        time. Prompt text, commands, responses, file names, and tool input are discarded before an
        activity signal is stored. Signals expire automatically. If team sharing is enabled, only
        this normalized status follows the project choices you approved.
      </p>
      {error && (
        <p className="connection-error agent-live-global-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
