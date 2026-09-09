import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe,
  Laptop,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { Repository } from '../../domain/types';
import type { TeamConnectionStatus, TeamDesktopApi } from '../../team/device';
import { useTeams, useTeamSharing } from '../hooks/useTeams';
import { useAction } from '../hooks/useAction';
import { TeamSharingPreview } from './TeamSharingPreview';
import { SharedProjects } from './SharedProjects';
import type { TeamSharingState } from '../../team/publishing';
import './teamConnections.css';

export function TeamConnectionsPanel({
  demo,
  repositories,
}: {
  demo: boolean;
  repositories: Repository[];
}) {
  const api = demo ? undefined : window.openbranches?.teams;
  const { state, error } = useTeams(api);
  const sharing = useTeamSharing(api);
  const [adding, setAdding] = useState(false),
    [origin, setOrigin] = useState(''),
    [deviceName, setDeviceName] = useState('My Mac');
  const action = useAction();
  if (demo) return null;
  return (
    <section className="settings-section mac-teams" aria-label="Team connections">
      <div className="mac-team-heading">
        <span className="discovery-icon">
          <Globe size={22} />
        </span>
        <div>
          <div className="section-kicker">YOUR TEAM, TOGETHER</div>
          <h2>Connect this Mac to your team.</h2>
        </div>
        <button
          className="secondary-button"
          disabled={
            !api || !state || !!state.error || action.busy || state.connections.length >= 10
          }
          onClick={() => {
            action.clear();
            setAdding((value) => !value);
          }}
        >
          <Plus size={15} />
          Connect a team
        </button>
      </div>
      <p className="muted-note">
        Use your team's OpenBranches address. Sign in and approve this Mac in the browser.
        Connecting does not share your projects.
      </p>
      {!api && <p className="muted-note">Team connections are available in the Mac app.</p>}
      {api && !state && !error && (
        <p role="status" className="muted-note">
          Loading team connections…
        </p>
      )}
      {(error || state?.error || action.error) && (
        <p className="connection-error" role="alert">
          {error || state?.error || action.error}
        </p>
      )}
      {state?.error && api && (
        <button
          className="secondary-button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api.refreshTeamConnections();
            })
          }
        >
          Retry connection storage
        </button>
      )}
      {adding && api && (
        <form
          className="mac-team-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await api.connectTeam({ origin: origin.trim(), deviceName: deviceName.trim() });
              setAdding(false);
              setOrigin('');
            });
          }}
        >
          <label>
            Team address
            <input
              autoFocus
              type="url"
              required
              maxLength={2048}
              placeholder="https://team.yourcompany.com"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Name for this Mac
            <input
              required
              maxLength={80}
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </label>
          <p className="muted-note">
            Your team host receives this device name when you request a code. Local project metadata
            stays on your Mac.
          </p>
          <div className="mac-team-actions">
            <button
              className="primary-button"
              disabled={action.busy || !origin.trim() || !deviceName.trim()}
            >
              {action.busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Get connection code
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="mac-team-list">
        {api &&
          state?.connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              api={api}
              connection={connection}
              repositories={repositories}
              sharing={sharing.state}
            />
          ))}
      </div>
      {api && (
        <SharedProjects
          api={api}
          sharing={sharing.state}
          connections={state}
          error={sharing.error}
        />
      )}
      {!!state?.connections.length && (
        <p className="muted-note mac-team-footnote">
          <ShieldCheck size={14} />
          Each team connection has its own device credential. Your personal Codex and Claude
          accounts are never sent to the team.
        </p>
      )}
    </section>
  );
}
function ConnectionCard({
  api,
  connection,
  repositories,
  sharing,
}: {
  api: TeamDesktopApi;
  connection: TeamConnectionStatus;
  repositories: Repository[];
  sharing?: TeamSharingState;
}) {
  const action = useAction(),
    [copied, setCopied] = useState(false),
    [review, setReview] = useState<'disconnect' | 'forget'>(),
    [preview, setPreview] = useState(false);
  const identity = connection.identity;
  const connected = connection.state === 'connected';
  return (
    <article className="mac-team-card">
      <header>
        <span className="settings-icon">
          <Laptop size={22} />
        </span>
        <div>
          <h3>{identity?.workspaceName ?? 'Finish connecting this Mac'}</h3>
          <span className="mac-team-origin">{connection.origin}</span>
        </div>
        <span className={'pill ' + (connected ? 'blue' : 'amber')}>
          {connected
            ? 'Paired'
            : connection.state === 'pairing'
              ? 'Awaiting approval'
              : connection.state === 'removing'
                ? 'Disconnect pending'
                : 'Access unavailable'}
        </span>
      </header>
      {identity && (
        <p className="muted-note">
          {identity.deviceName} · @{identity.login}
          {connection.checkedAt
            ? ' · Checked ' +
              new Date(connection.checkedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })
            : ' · Checking access…'}
        </p>
      )}
      {connection.pairing && (
        <div className="mac-team-code">
          <span className="section-kicker">ENTER THIS CODE IN YOUR TEAM WORKSPACE</span>
          <div>
            <code>{connection.pairing.code}</code>
            <button
              className="icon-button"
              aria-label="Copy team connection code"
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(connection.pairing!.code);
                  setCopied(true);
                })
              }
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          <p className="muted-note">
            Choose Connect a Mac in the browser. This code expires at{' '}
            {new Date(connection.pairing.expiresAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
            .
          </p>
        </div>
      )}
      {connected && (
        <p className="mac-team-sharing-off">
          <ShieldCheck size={15} />
          Only projects you approve are shared. Review the metadata and task-text choices for each
          project.
        </p>
      )}
      {connection.state === 'removing' && (
        <p className="muted-note">
          Waiting for the team service to confirm cancellation or withdrawal. This Mac will keep
          retrying, including after restart.
        </p>
      )}
      {connection.state === 'unavailable' && (
        <p className="muted-note">
          The code or device access may have expired or been revoked. Previously shared reports may
          remain visible as outdated; a team owner can remove the device.
        </p>
      )}
      {(action.error || connection.error) && (
        <p className="connection-error" role="alert">
          {action.error || connection.error}
        </p>
      )}
      <div className="mac-team-actions">
        <button
          className="secondary-button"
          disabled={action.busy}
          onClick={() => void action.run(() => api.openTeam(connection.id))}
        >
          Open team in browser
          <ArrowUpRight size={14} />
        </button>
        {connected && (
          <button
            className="primary-button"
            disabled={action.busy || !connection.projects || !!connection.error}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? 'Close sharing preview' : 'Review project sharing'}
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Refresh team connection"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api.refreshTeamConnections();
            })
          }
        >
          <RefreshCw size={15} />
        </button>
        <button
          className="text-button"
          disabled={action.busy}
          onClick={() => {
            action.clear();
            setReview(
              connection.state === 'unavailable' || connection.state === 'removing'
                ? 'forget'
                : 'disconnect',
            );
          }}
        >
          {connection.state === 'pairing'
            ? 'Cancel connection'
            : connection.state === 'unavailable' || connection.state === 'removing'
              ? 'Forget on this Mac'
              : 'Disconnect'}
        </button>
      </div>
      {review && (
        <div className="mac-team-confirm" role="group" aria-label="Review team disconnection">
          <strong>
            {review === 'forget' ? 'Forget this saved connection?' : 'Disconnect this Mac?'}
          </strong>
          <p>
            {review === 'forget'
              ? 'This removes the credential saved on this Mac. It cannot withdraw reports already received by the team service. Ask a team owner to revoke the device in the browser.'
              : 'The team service will revoke this device and withdraw its shared local reports. Your local files, branches, and personal projects stay in place.'}
          </p>
          <div className="mac-team-actions">
            <button
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setReview(undefined)}
            >
              Keep connection
            </button>
            <button
              className="secondary-button danger-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  if (review === 'forget') await api.forgetTeam(connection.id);
                  else await api.disconnectTeam(connection.id);
                  setReview(undefined);
                })
              }
            >
              {action.busy
                ? 'Updating…'
                : review === 'forget'
                  ? 'Forget connection'
                  : 'Disconnect Mac'}
            </button>
          </div>
        </div>
      )}
      {preview && connected && (
        <TeamSharingPreview
          api={api}
          connection={connection}
          repositories={repositories}
          sharing={sharing}
        />
      )}
    </article>
  );
}
