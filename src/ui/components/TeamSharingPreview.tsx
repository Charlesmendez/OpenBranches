import { useEffect, useState } from 'react';
import { ArrowRight, Eye, GitBranch, ShieldCheck } from 'lucide-react';
import type { Repository } from '../../domain/types';
import type { SharingPreview, TeamConnectionStatus, TeamDesktopApi } from '../../team/device';
import { useAction } from '../hooks/useAction';
import { ProjectSearch } from './ProjectSearch';
import { projectMatches } from '../../domain/projects';
import type { TeamSharingState } from '../../team/publishing';
export function TeamSharingPreview({
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
  const [query, setQuery] = useState(''),
    [repositoryId, setRepository] = useState(''),
    [projectId, setProject] = useState(''),
    [titles, setTitles] = useState(false),
    [summaries, setSummaries] = useState(false),
    [preview, setPreview] = useState<SharingPreview>();
  const [approved, setApproved] = useState('');
  const action = useAction();
  const projects = connection.projects?.filter((p) => p.canShare) ?? [];
  const local = repositories.filter((repository) => projectMatches(repository, query));
  const occupied = (id: string) =>
    sharing?.shares.some(
      (s) => s.connectionId === connection.id && s.projectId === id && s.state !== 'stopped',
    );
  const visiblePreview =
    preview &&
    repositories.some((r) => r.id === preview.repositoryId) &&
    projects.some((p) => p.id === preview.projectId)
      ? preview
      : undefined;
  useEffect(() => {
    setPreview((previous) =>
      previous &&
      (!repositories.some((r) => r.id === previous.repositoryId) ||
        !connection.projects?.some((p) => p.id === previous.projectId && p.canShare))
        ? undefined
        : previous,
    );
  }, [repositories, connection.projects]);
  return (
    <section className="mac-sharing-preview" aria-label="Review project sharing">
      <div className="section-kicker">CHOOSE, THEN REVIEW</div>
      <h3>A clear view of what would leave your Mac.</h3>
      <p className="muted-note">
        Match a local project to its destination in {connection.identity?.workspaceName}. Names
        alone never connect projects automatically.
      </p>
      {connection.complete === false && (
        <p className="connection-error">
          The project list is incomplete. Refresh the connection or ask your team owner for help.
        </p>
      )}
      <ProjectSearch label="Search local projects for sharing" query={query} onChange={setQuery} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () =>
            setPreview(
              await api.previewTeamSharing({
                connectionId: connection.id,
                repositoryId,
                projectId,
                consent: { taskTitles: titles, taskSummaries: summaries },
              }),
            ),
          );
        }}
      >
        <div className="mac-project-match">
          <label>
            Project on this Mac
            <select
              required
              disabled={action.busy}
              value={repositoryId}
              onChange={(event) => {
                setRepository(event.target.value);
                setPreview(undefined);
              }}
            >
              <option value="">Choose a local project</option>
              {repositoryId && !local.some((r) => r.id === repositoryId) && (
                <option value={repositoryId}>
                  {repositories.find((r) => r.id === repositoryId)?.name ??
                    'Project no longer monitored'}
                </option>
              )}
              {local.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight size={20} />
          <label>
            Team destination
            <select
              required
              disabled={action.busy}
              value={projectId}
              onChange={(event) => {
                setProject(event.target.value);
                setPreview(undefined);
              }}
            >
              <option value="">Choose a team project</option>
              {projectId && !projects.some((p) => p.id === projectId) && (
                <option value={projectId}>Project access changed</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id} disabled={occupied(project.id)}>
                  {project.name}
                  {occupied(project.id) ? ' · already selected for sharing' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!projects.length && (
          <p className="muted-note">
            A team owner needs to give your account sharing access to a project.
          </p>
        )}
        <div className="mac-consent-options">
          <label>
            <input
              type="checkbox"
              disabled={action.busy}
              checked={titles}
              onChange={(event) => {
                setTitles(event.target.checked);
                setPreview(undefined);
              }}
            />
            Include task titles
          </label>
          <label>
            <input
              type="checkbox"
              disabled={action.busy}
              checked={summaries}
              onChange={(event) => {
                setSummaries(event.target.checked);
                setPreview(undefined);
              }}
            />
            Include task summaries
          </label>
        </div>
        <p className="muted-note">
          The default preview includes branch names, commits, working-copy counts, target history,
          and recorded tool/model associations. These names and identifiers can reveal what you are
          working on.
        </p>
        <button
          className="secondary-button"
          disabled={
            action.busy ||
            !repositories.some((r) => r.id === repositoryId) ||
            !projects.some((p) => p.id === projectId) ||
            occupied(projectId)
          }
        >
          <Eye size={15} />
          {action.busy ? 'Preparing…' : 'Preview shared metadata'}
        </button>
      </form>
      {approved && (
        <p className="mac-team-sharing-off" role="status">
          <ShieldCheck size={15} />
          Sharing approved for {approved}. Follow its upload status in Shared projects below.
        </p>
      )}
      {action.error && (
        <p className="connection-error" role="alert">
          {action.error}
        </p>
      )}
      {visiblePreview && preview && (
        <div className="mac-payload-review">
          <div className="mac-preview-title">
            <GitBranch size={19} />
            <div>
              <strong>
                {preview.repositoryName} → {preview.projectName}
              </strong>
              <p>
                {preview.snapshot.branches.length} branch reports · observed{' '}
                {new Date(preview.snapshot.observedAt).toLocaleString()}
              </p>
            </div>
            <span className="pill blue">Ready for review</span>
          </div>
          {preview.snapshot.sourceError && (
            <p className="connection-error">
              The last local scan reported an error. Refresh the project before sharing.
            </p>
          )}
          {preview.snapshot.omittedBranches > 0 && (
            <p className="muted-note">
              {preview.snapshot.omittedBranches} additional branches were omitted by the metadata
              limit.
            </p>
          )}
          <ul>
            {preview.snapshot.branches.slice(0, 8).map((branch) => (
              <li key={branch.key}>
                <GitBranch size={13} />
                <code>{branch.name}</code>
                <span>{branch.tasks.length} recorded sessions</span>
              </li>
            ))}
          </ul>
          <details>
            <summary>Inspect the complete metadata preview</summary>
            <textarea
              readOnly
              aria-label="Complete sharing metadata preview"
              value={JSON.stringify(preview.snapshot, null, 2)}
            />
          </details>
          <p className="mac-team-sharing-off">
            <ShieldCheck size={15} />
            Approving keeps this project's branch metadata updated for authorized teammates while
            OpenBranches runs. Only the task-text choices shown above are included. You can stop
            sharing at any time.
          </p>
          <button
            className="primary-button"
            disabled={action.busy || occupied(preview.projectId)}
            onClick={() =>
              void action.run(async () => {
                await api.approveTeamSharing(preview.id);
                setApproved(preview.repositoryName);
                setPreview(undefined);
                setProject('');
              })
            }
          >
            <ShieldCheck size={15} />
            {action.busy ? 'Saving choice…' : 'Approve and start sharing'}
          </button>
        </div>
      )}
    </section>
  );
}
