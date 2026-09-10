import {
  Activity,
  ArrowUpRight,
  CircleDot,
  FolderGit2,
  Layers,
  Laptop,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Repository, View } from '../../domain/types';
import { useEffect, useState } from 'react';
import { projectMatches } from '../../domain/projects';
import { ProjectSearch } from './ProjectSearch';
import { Brand } from './Primitives';
import { WorkspaceSwitcher, type WorkspaceTeamApi } from './WorkspaceSwitcher';

interface Props {
  repositories: Repository[];
  selectedId: string | null;
  view: View;
  attentionCount: number;
  demo: boolean;
  gitNeedsSetup: boolean;
  onProject: (id: string | null) => void;
  onView: (view: View) => void;
  onAdd: () => void;
  onMode: () => void;
  teamApi?: WorkspaceTeamApi;
  onError: (message: string) => void;
}
export function Sidebar(p: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [p.demo]);
  const visible = p.repositories.filter((repository) => projectMatches(repository, query));
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Brand />
      </div>
      <WorkspaceSwitcher
        demo={p.demo}
        api={p.teamApi}
        onMode={p.onMode}
        onSettings={() => p.onView('settings')}
        onError={p.onError}
      />
      <nav className="primary-nav" aria-label="Workspace">
        <button
          className={!p.selectedId && p.view === 'map' ? 'selected' : ''}
          onClick={() => {
            p.onProject(null);
            p.onView('map');
          }}
        >
          <Layers size={17} />
          All projects<span className="nav-count">{p.repositories.length}</span>
        </button>
        <button
          className={p.view === 'attention' ? 'selected' : ''}
          onClick={() => p.onView('attention')}
        >
          <Sparkles size={17} />
          Needs attention
          {p.attentionCount > 0 && (
            <span className="attention-count" title={`${p.attentionCount} review queues`}>
              {p.attentionCount}
            </span>
          )}
        </button>
        <button
          className={p.view === 'activity' ? 'selected' : ''}
          onClick={() => p.onView('activity')}
        >
          <Activity size={17} />
          Activity
        </button>
        <button
          className={p.view === 'people' ? 'selected' : ''}
          onClick={() => p.onView('people')}
        >
          <Users size={17} />
          People &amp; PRs
        </button>
      </nav>
      <div className="nav-section-heading">
        <span>PROJECTS</span>
        <button aria-label="Add repository" title="Add repository" onClick={p.onAdd}>
          <Plus size={15} />
        </button>
      </div>
      <div className="sidebar-project-tools">
        <ProjectSearch query={query} onChange={setQuery} />
        <button className="text-button" onClick={() => p.onView('settings')}>
          Manage projects
        </button>
      </div>
      <nav className="project-nav" aria-label="Repositories">
        {visible.map((repo) => (
          <button
            key={repo.id}
            className={
              p.selectedId === repo.id &&
              !['people', 'attention', 'activity', 'settings'].includes(p.view)
                ? 'selected'
                : ''
            }
            onClick={() => {
              p.onProject(repo.id);
              p.onView('map');
            }}
          >
            <FolderGit2 size={17} />
            <span>{repo.name}</span>
            <span className="project-count">{repo.branches.length}</span>
          </button>
        ))}
        {!!p.repositories.length && !visible.length && (
          <p className="project-search-empty" role="status">
            No projects match.
          </p>
        )}
        {!p.repositories.length && (
          <button className="add-empty-project" onClick={p.onAdd}>
            <Plus size={16} />
            Add your first project
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="machine">
          <Laptop size={17} />
          <span>
            This Mac
            <small>
              {p.demo
                ? 'Demo sources'
                : p.gitNeedsSetup
                  ? 'Git setup needed'
                  : 'Local repositories'}
            </small>
          </span>
          <span className={`status-dot ${p.demo || p.gitNeedsSetup ? 'muted' : ''}`} />
        </div>
        <button className="demo-switch" onClick={p.onMode}>
          <CircleDot size={14} />
          <span>{p.demo ? 'Connect your projects' : 'Explore the demo'}</span>
          <ArrowUpRight size={13} />
        </button>
        <button
          className={`settings-nav ${p.view === 'settings' ? 'selected' : ''}`}
          onClick={() => p.onView('settings')}
        >
          <Settings2 size={16} />
          Settings<span className="version">v0.1</span>
        </button>
      </div>
    </aside>
  );
}
