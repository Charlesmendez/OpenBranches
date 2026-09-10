import { useId, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Settings2,
  Users,
} from 'lucide-react';
import type { TeamConnectionStatus, TeamDesktopApi } from '../../team/device';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useTeams } from '../hooks/useTeams';
import { workspaceConnections, workspaceTeamName } from '../workspaceDestinations';

export type WorkspaceTeamApi = Pick<
  TeamDesktopApi,
  'getTeamConnections' | 'onTeamConnections' | 'openTeam'
>;

export function WorkspaceSwitcher({
  demo,
  api,
  onMode,
  onSettings,
  onError,
}: {
  demo: boolean;
  api?: WorkspaceTeamApi;
  onMode: () => void;
  onSettings: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string>();
  const { root, trigger } = useDismissiblePopover(open, setOpen);
  const menuId = useId();
  const teams = useTeams(demo ? undefined : api);
  const connections = useMemo(
    () => workspaceConnections(teams.state?.connections ?? []),
    [teams.state?.connections],
  );
  const chooseTeam = async (id: string) => {
    if (!api || openingId) return;
    setOpeningId(id);
    try {
      await api.openTeam(id);
      setOpen(false);
    } catch {
      onError('Could not open that team workspace. Check its connection in Settings.');
    } finally {
      setOpeningId(undefined);
    }
  };
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => !button.disabled,
    );
    if (!choices.length) return;
    event.preventDefault();
    const current = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % choices.length
            : (current - 1 + choices.length) % choices.length;
    choices[next].focus();
  };

  return (
    <div className="workspace-switcher" ref={root}>
      <button
        ref={trigger}
        className="space-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-avatar">O</span>
        <span className="space-switch-copy">
          <strong>Your workspace</strong>
          <small>{demo ? 'Interactive demo' : 'Personal workspace'}</small>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          className="workspace-menu"
          role="menu"
          aria-label="Switch workspace"
          onKeyDown={moveFocus}
        >
          <span className="workspace-menu-label">CURRENT WORKSPACE</span>
          <button
            autoFocus
            role="menuitemradio"
            aria-checked="true"
            className="workspace-option selected"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <span className="workspace-avatar">O</span>
            <span className="workspace-option-copy">
              <strong>Your workspace</strong>
              <small>{demo ? 'Fictional projects' : 'Projects on this Mac'}</small>
            </span>
            <Check size={14} aria-hidden="true" />
          </button>

          {!demo && (
            <>
              <span className="workspace-menu-label team-label">TEAM WORKSPACES</span>
              {!teams.state && !teams.error && api && (
                <span className="workspace-menu-message" role="status">
                  <LoaderCircle className="spin" size={14} /> Loading teams…
                </span>
              )}
              {(teams.error || teams.state?.error) && (
                <span className="workspace-menu-message issue" role="status">
                  <CircleAlert size={14} /> Team connections unavailable
                </span>
              )}
              {connections.map((connection) => (
                <button
                  key={connection.id}
                  role="menuitem"
                  className={`workspace-option team ${connection.state}`}
                  disabled={!!openingId}
                  onClick={() => void chooseTeam(connection.id)}
                >
                  <span className="workspace-team-avatar">
                    {connection.identity?.workspaceName?.trim().charAt(0).toUpperCase() || (
                      <Users size={14} />
                    )}
                  </span>
                  <span className="workspace-option-copy">
                    <strong>{workspaceTeamName(connection)}</strong>
                    <small>{teamDetail(connection)}</small>
                  </span>
                  {openingId === connection.id ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <ArrowUpRight size={14} aria-hidden="true" />
                  )}
                </button>
              ))}
              {teams.state && !connections.length && !teams.state.error && (
                <span className="workspace-menu-message">No team connected yet.</span>
              )}
            </>
          )}

          <div className="workspace-menu-footer">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (demo) onMode();
                else onSettings();
              }}
            >
              {demo ? <ArrowUpRight size={13} /> : <Settings2 size={13} />}
              {demo
                ? 'Connect your projects'
                : connections.length
                  ? 'Manage teams'
                  : 'Connect a team'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function teamDetail(connection: TeamConnectionStatus) {
  if (connection.state === 'connected')
    return connection.error
      ? `${connection.identity ? `@${connection.identity.login} · ` : ''}Update delayed`
      : connection.identity
        ? `@${connection.identity.login} · Open dashboard`
        : 'Open dashboard';
  if (connection.state === 'pairing') return 'Finish approving this Mac';
  if (connection.state === 'removing') return 'Disconnect pending';
  return 'Connection needs attention';
}
