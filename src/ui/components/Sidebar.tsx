import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleDot,
  FolderGit2,
  Layers,
  Laptop,
  Plus,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { Repository, View } from '../../domain/types';
import { Brand } from './Primitives';

interface Props {
  repositories: Repository[];
  selectedId: string | null;
  view: View;
  attentionCount: number;
  demo: boolean;
  onProject: (id: string | null) => void;
  onView: (view: View) => void;
  onAdd: () => void;
  onMode: () => void;
}
export function Sidebar(p: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Brand />
      </div>
      <div className="space-switch">
        <span className="workspace-avatar">O</span>
        <div>
          <strong>Your workspace</strong>
          <small>{p.demo ? 'Interactive demo' : 'Personal workspace'}</small>
        </div>
        <ChevronDown size={13} />
      </div>
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
          {p.attentionCount > 0 && <span className="attention-count">{p.attentionCount}</span>}
        </button>
        <button
          className={p.view === 'activity' ? 'selected' : ''}
          onClick={() => p.onView('activity')}
        >
          <Activity size={17} />
          Activity
        </button>
      </nav>
      <div className="nav-section-heading">
        <span>PROJECTS</span>
        <button aria-label="Add repository" title="Add repository" onClick={p.onAdd}>
          <Plus size={15} />
        </button>
      </div>
      <nav className="project-nav" aria-label="Repositories">
        {p.repositories.map((repo) => (
          <button
            key={repo.id}
            className={
              p.selectedId === repo.id && !['attention', 'activity', 'settings'].includes(p.view)
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
            This Mac<small>{p.demo ? 'Demo sources' : 'Local repositories'}</small>
          </span>
          <span className={`status-dot ${p.demo ? 'muted' : ''}`} />
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
