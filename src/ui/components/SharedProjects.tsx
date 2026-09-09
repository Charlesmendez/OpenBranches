import { useState } from 'react';
import { Check, CloudUpload, RefreshCw, Square } from 'lucide-react';
import type { TeamDesktopApi, TeamConnectionsState } from '../../team/device';
import type { TeamSharingState, TeamShareStatus } from '../../team/publishing';
import { useAction } from '../hooks/useAction';
import { ProjectSearch } from './ProjectSearch';

export function SharedProjects({
  api,
  sharing,
  connections,
  error,
}: {
  api: TeamDesktopApi;
  sharing?: TeamSharingState;
  connections?: TeamConnectionsState;
  error?: string;
}) {
  const action = useAction();
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(8);
  const needle = query.trim().toLocaleLowerCase();
  const shares =
    sharing?.shares.filter((s) =>
      [s.repositoryName, s.projectName, s.teamName].some((v) =>
        v.toLocaleLowerCase().includes(needle),
      ),
    ) ?? [];
  return (
    <section className="mac-shared-projects" aria-label="Shared projects">
      <div className="mac-team-heading">
        <CloudUpload size={23} />
        <div>
          <div className="section-kicker">SHARED BY YOU</div>
          <h3>Projects your team can see.</h3>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh sharing status"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api.refreshTeamSharing();
            })
          }
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="muted-note">
        Approved projects update while OpenBranches runs. Stop sharing withdraws their local reports
        and keeps your files and branches in place.
      </p>
      {(error || sharing?.error || action.error) && (
        <p className="connection-error" role="alert">
          {error || sharing?.error || action.error}
        </p>
      )}
      {!sharing && !error && (
        <p className="muted-note" role="status">
          Loading sharing choices…
        </p>
      )}
      {sharing && !sharing.shares.length && (
        <p className="mac-team-sharing-off">
          <Check size={15} />
          No local projects are shared. Open a connected team's project review to choose one.
        </p>
      )}
      {!!sharing?.shares.length && (
        <>
          <ProjectSearch
            label="Search shared projects"
            query={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(8);
            }}
          />
          <div className="mac-shared-list">
            {shares.slice(0, limit).map((share) => (
              <SharedProject
                key={share.id}
                api={api}
                share={share}
                connected={
                  connections?.connections.some(
                    (c) => c.id === share.connectionId && c.state === 'connected',
                  ) === true
                }
              />
            ))}
          </div>
          {!shares.length && <p className="muted-note">No shared projects match this search.</p>}
          {shares.length > limit && (
            <button className="secondary-button" onClick={() => setLimit((value) => value + 8)}>
              Show more projects ({shares.length - limit} remaining)
            </button>
          )}
        </>
      )}
    </section>
  );
}
function SharedProject({
  api,
  share,
  connected,
}: {
  api: TeamDesktopApi;
  share: TeamShareStatus;
  connected: boolean;
}) {
  const action = useAction(),
    [forgetting, setForgetting] = useState(false);
  const stopped = share.state === 'stopped';
  const label = stopped
    ? 'Stopped'
    : share.state === 'stopping'
      ? 'Withdrawal pending'
      : share.state === 'paused'
        ? 'Needs review'
        : share.state === 'starting'
          ? 'Starting'
          : share.error
            ? 'Update delayed'
            : share.busy
              ? 'Updating'
              : 'Sharing';
  return (
    <article className="mac-shared-project">
      <header>
        <div>
          <h4>
            {share.repositoryName} <span>→</span> {share.projectName}
          </h4>
          <p>{share.teamName}</p>
        </div>
        <span className={'pill ' + (share.state === 'sharing' && !share.error ? 'teal' : 'amber')}>
          {label}
        </span>
      </header>
      <div className="mac-sharing-fields">
        <span>Branch metadata</span>
        <span>Task titles {share.consent.taskTitles ? 'on' : 'off'}</span>
        <span>Task summaries {share.consent.taskSummaries ? 'on' : 'off'}</span>
      </div>
      <p className="muted-note">
        {stopped
          ? 'The team service confirmed withdrawal.'
          : share.lastUploadedAt
            ? 'Last acknowledged upload: ' + new Date(share.lastUploadedAt).toLocaleString()
            : 'No upload acknowledged yet.'}
        {!stopped &&
          share.observedAt &&
          ' · Observed ' + new Date(share.observedAt).toLocaleString()}
      </p>
      {share.state === 'stopping' && (
        <p className="muted-note">
          {share.stopSaved
            ? 'Uploads are stopped on this Mac. Remote withdrawal will retry, including after restart. Reports may remain visible until the team service confirms.'
            : 'Stop sharing has not been saved yet. Keep this app open and retry before restarting.'}
        </p>
      )}
      {(action.error || share.error) && (
        <p className="connection-error" role="alert">
          {action.error || share.error}
        </p>
      )}
      <div className="mac-team-actions">
        {!stopped && (
          <button
            className="secondary-button"
            disabled={action.busy || (share.state === 'stopping' && share.stopSaved)}
            onClick={() =>
              void action.run(async () => {
                await api.stopTeamSharing(share.id);
              })
            }
          >
            <Square size={12} />
            {share.stopSaved ? 'Stop sharing' : 'Retry Stop sharing'}
          </button>
        )}
        {(stopped || !connected) && (
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => {
              if (stopped)
                void action.run(async () => {
                  await api.forgetTeamSharing(share.id);
                });
              else setForgetting(true);
            }}
          >
            {stopped ? 'Remove from list' : 'Forget local record'}
          </button>
        )}
      </div>
      {forgetting && (
        <div
          className="mac-team-confirm"
          role="group"
          aria-label="Review forgetting shared project"
        >
          <strong>Remove only this Mac's sharing record?</strong>
          <p>
            This cannot withdraw reports already on the team service. Ask a team owner to revoke the
            disconnected device first.
          </p>
          <div className="mac-team-actions">
            <button
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setForgetting(false)}
            >
              Keep record
            </button>
            <button
              className="secondary-button danger-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.forgetTeamSharing(share.id);
                })
              }
            >
              Forget record
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
