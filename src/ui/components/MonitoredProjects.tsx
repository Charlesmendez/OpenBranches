import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, EyeOff, FolderGit2, LoaderCircle, Plus } from 'lucide-react';
import type { Repository } from '../../domain/types';
import { shortPath } from '../../domain/branches';
import { projectMatches } from '../../domain/projects';
import { ProjectSearch } from './ProjectSearch';

export function MonitoredProjects({
  repositories,
  demo,
  onRemove,
  onAdd,
  onLive,
}: {
  repositories: Repository[];
  demo: boolean;
  onRemove: (id: string) => Promise<boolean>;
  onAdd: () => void;
  onLive: () => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const [busy, setBusy] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Pick<Repository, 'id' | 'name'> | null>(null);
  const notice =
    removed && !repositories.some((repository) => repository.id === removed.id)
      ? `Stopped monitoring ${removed.name}. Its files, branches, and worktrees stay on your Mac.`
      : '';
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (notice) heading.current?.focus({ preventScroll: true });
  }, [notice]);
  const filtered = repositories.filter((repository) => projectMatches(repository, query));
  const remove = async (repository: Repository) => {
    if (busy) return;
    setBusy(repository.id);
    setRemoved(null);
    if (await onRemove(repository.id)) setRemoved({ id: repository.id, name: repository.name });
    setBusy(null);
  };
  return (
    <section className="settings-section monitored-projects" aria-label="Monitored projects">
      <div className="monitored-heading">
        <div>
          <div className="section-kicker">YOUR PROJECTS</div>
          <h2 ref={heading} tabIndex={-1}>
            {demo ? 'A workspace to explore.' : 'Choose what stays in view.'}
          </h2>
        </div>
        <button className="secondary-button" onClick={demo ? onLive : onAdd}>
          {demo ? <ArrowUpRight size={15} /> : <Plus size={15} />}
          {demo ? 'Connect your projects' : 'Add project'}
        </button>
      </div>
      <p className="muted-note">
        {demo
          ? 'These projects are fictional. Switch to your workspace to manage real project connections.'
          : 'Stop monitoring a project to remove it from OpenBranches. Its files, branches, and worktrees stay in place. Add it again whenever you need it.'}
      </p>
      <ProjectSearch
        query={query}
        label="Find a monitored project"
        onChange={(value) => {
          setQuery(value);
          setLimit(8);
        }}
      />
      <div className="monitored-list">
        {filtered.slice(0, limit).map((repository) => (
          <div className="monitored-row" key={repository.id}>
            <FolderGit2 size={19} />
            <div>
              <strong>{repository.name}</strong>
              <span title={repository.path}>{shortPath(repository.path)}</span>
              <small>
                {repository.worktrees.length}{' '}
                {repository.worktrees.length === 1 ? 'worktree' : 'worktrees'}
              </small>
            </div>
            {demo ? (
              <span className="muted-note">Demo project</span>
            ) : (
              <button
                className="secondary-button"
                aria-label={`Stop monitoring ${repository.name}`}
                disabled={!!busy}
                onClick={() => void remove(repository)}
              >
                {busy === repository.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <EyeOff size={14} />
                )}
                Stop monitoring
              </button>
            )}
          </div>
        ))}
      </div>
      {!filtered.length && (
        <p className="monitored-empty">
          {repositories.length
            ? 'No projects match your search.'
            : 'No projects are being monitored yet.'}
        </p>
      )}
      {filtered.length > limit && (
        <button className="text-button" onClick={() => setLimit((value) => value + 8)}>
          Show more projects · {filtered.length - limit} remaining
        </button>
      )}
      {notice && (
        <p className="monitored-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
