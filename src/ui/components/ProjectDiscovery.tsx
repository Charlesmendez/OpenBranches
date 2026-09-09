import { useEffect, useRef, useState } from 'react';
import { FolderSearch, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ProjectDiscoveryState } from '../../domain/types';
import { relativeTime, shortPath } from '../../domain/branches';
import { ProjectSearch } from './ProjectSearch';
import { projectMatches } from '../../domain/projects';

export function ProjectDiscovery({ demo }: { demo: boolean }) {
  const [state, setState] = useState<ProjectDiscoveryState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const running = useRef(false);
  useEffect(() => {
    const api = window.openbranches;
    if (demo || !api) return;
    let current = true;
    let updated = false;
    const off = api.onDiscoveredProjects((next) => {
      updated = true;
      if (current) setState(next);
    });
    void api
      .getDiscoveredProjects()
      .then((next) => {
        if (current && !updated) setState(next);
      })
      .catch(() => {
        if (current && !updated)
          setError('Could not load project discovery. Try opening Settings again.');
      });
    return () => {
      current = false;
      off();
    };
  }, [demo]);
  if (demo) return null;
  const action = async (run: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await run();
    } catch {
      setError('Could not save the discovery setting. Please try again.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const disabled = busy || !state;
  const projects = state?.projects ?? [];
  const filtered = projects.filter((project) => projectMatches(project, query));
  return (
    <section
      className="settings-section project-discovery"
      aria-label="Automatic project discovery"
    >
      <div className="discovery-heading">
        <span className="discovery-icon">
          <FolderSearch size={22} />
        </span>
        <div>
          <div className="section-kicker">ALREADY IN CODEX</div>
          <h2>Bring your projects with you.</h2>
        </div>
      </div>
      <p className="muted-note">
        Follow saved Codex projects on this Mac, including new ones you add later. Projects you
        remove stay excluded.
      </p>
      <div className="discovery-actions">
        <button
          className={state?.enabled ? 'secondary-button' : 'primary-button'}
          disabled={disabled || state?.recoveryNeeded}
          onClick={() =>
            void action(() => window.openbranches!.followDiscoveredProjects(!state?.enabled))
          }
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          {state?.enabled ? 'Stop following Codex projects' : 'Follow Codex projects'}
        </button>
        <button
          className="secondary-button"
          disabled={disabled || state?.scanning}
          onClick={() => void action(() => window.openbranches!.refreshDiscoveredProjects())}
        >
          <RefreshCw size={14} /> Check again
        </button>
      </div>
      <p className="discovery-status" role="status">
        {state?.scanning
          ? 'Checking saved project folders…'
          : state
            ? `${projects.length} saved folders found${state.checkedAt ? ` · checked ${relativeTime(state.checkedAt).toLowerCase()}` : ''}`
            : 'Loading project discovery…'}
      </p>
      {state?.enabled && (
        <p className="muted-note">
          Following projects every minute. Stop following to pause new additions; projects already
          monitored stay in your workspace.
        </p>
      )}
      {!!state?.pendingCount && (
        <p className="muted-note">
          {state.pendingCount} folders are queued. Discovery continues in batches each minute; you
          can keep using the app.
        </p>
      )}
      {!!state?.failedCount && (
        <p className="muted-note">
          {state.failedCount} folders could not be added. They may be unavailable or may not contain
          a Git repository. We’ll retry when discovery runs.
        </p>
      )}
      {projects.length > 0 && (
        <details className="discovered-projects">
          <summary>Review discovered folders</summary>
          <ProjectSearch
            label="Search discovered projects"
            query={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(8);
            }}
          />
          <ul>
            {filtered.slice(0, limit).map((project) => (
              <li key={project.id}>
                <strong>{project.name}</strong>
                <span title={project.path}>{shortPath(project.path)}</span>
                {!project.available && <small>Folder unavailable</small>}
              </li>
            ))}
          </ul>
          {!filtered.length && <p className="muted-note">No discovered projects match.</p>}
          {filtered.length > limit && (
            <button className="text-button" onClick={() => setLimit((value) => value + 8)}>
              Show more · {filtered.length - limit} remaining
            </button>
          )}
        </details>
      )}
      {(!!state?.excludedCount || state?.recoveryNeeded) && (
        <div className="discovery-excluded">
          <p>
            {state.recoveryNeeded
              ? 'Removed-project choices could not be read. Following is paused until you reset those choices.'
              : `${state.excludedCount} removed ${state.excludedCount === 1 ? 'project is' : 'projects are'} excluded from automatic additions.`}
          </p>
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => void action(() => window.openbranches!.restoreDiscoveredProjects())}
          >
            Allow removed projects again
          </button>
        </div>
      )}
      {(error || state?.error) && (
        <p className="discovery-error" role="alert">
          {error || state?.error}
        </p>
      )}
    </section>
  );
}
