import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Command,
  FolderPlus,
  GitBranch,
  Cloud,
  List,
  LoaderCircle,
  Map,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { Branch, Lifecycle, View } from '../domain/types';
import { featureBranches, groupCounts, lifecycleLabels, lifecycleOf } from '../domain/branches';
import { useWorkspace } from './hooks/useWorkspace';
import { useProviders } from './hooks/useProviders';
import { useGit } from './hooks/useGit';
import { useReviews } from './hooks/useReviews';
import { GitSetup } from './components/GitSetup';
import { Sidebar } from './components/Sidebar';
import { Overview, ActivityList } from './components/Overview';
import { BranchMap } from './components/BranchMap';
import { Inventory } from './components/Inventory';
import { Inspector } from './components/Inspector';
import { Attention } from './components/Attention';
import { SearchDialog } from './components/SearchDialog';
import { Settings } from './components/Settings';
import { EmptyState, IconButton } from './components/Primitives';

export function App() {
  const workspace = useWorkspace();
  const providers = useProviders();
  const git = useGit();
  const gitNeedsSetup = !!git.status && git.status.state !== 'ready';
  const { snapshot, mode, setMode, error, setError, loading, adding, add, refresh } = workspace;
  const reviews = useReviews(mode === 'demo', snapshot.repositories);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<View>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [group, setGroup] = useState<Lifecycle>('active');
  const [searchOpen, setSearchOpen] = useState(false);
  const repository = snapshot.repositories.find((r) => r.id === projectId);
  const branches = useMemo(() => (repository ? featureBranches(repository) : []), [repository]);
  const counts = useMemo(() => groupCounts(branches), [branches]);
  const grouped = useMemo(
    () => branches.filter((branch) => lifecycleOf(branch) === group),
    [branches, group],
  );
  const selected = repository?.branches.find((branch) => branch.id === selectedId);
  useEffect(() => {
    if (
      !loading &&
      projectId &&
      !snapshot.repositories.some((repository) => repository.id === projectId)
    ) {
      setProjectId(null);
      setSelectedId(null);
    }
  }, [loading, projectId, snapshot.repositories]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error, setError]);
  const selectProject = (id: string | null) => {
    setProjectId(id);
    setSelectedId(null);
    setGroup('active');
  };
  const selectBranch = (branch: Branch) => setSelectedId(branch.id);
  const navigateBranch = (repoId: string, branchId?: string) => {
    setProjectId(repoId);
    setSelectedId(branchId ?? null);
    setView(branchId ? 'inventory' : 'map');
  };
  const addRepository = async () => {
    if (gitNeedsSetup) {
      setView('settings');
      return;
    }
    const added = await add();
    if (added) {
      selectProject(added.id);
      setView('map');
    }
  };
  const switchMode = () => {
    setMode(mode === 'demo' ? 'live' : 'demo');
    selectProject(null);
    setView('map');
  };
  const isProjectView = repository && ['map', 'inventory'].includes(view);
  const firstSetup =
    !loading &&
    mode === 'live' &&
    gitNeedsSetup &&
    !snapshot.repositories.length &&
    ['map', 'inventory'].includes(view);
  const title =
    view === 'settings'
      ? 'Make yourself at home.'
      : view === 'attention'
        ? 'A little less to keep in your head.'
        : view === 'activity'
          ? 'The work keeps moving.'
          : repository
            ? view === 'inventory'
              ? 'Find your thread.'
              : 'Your work, connected.'
            : 'A pulse on every project.';
  const subtitle =
    view === 'settings'
      ? 'Your connections, your data, your way of working.'
      : view === 'attention'
        ? 'Evidence first. A few useful next steps.'
        : view === 'activity'
          ? 'A running history of what changed across your projects.'
          : repository
            ? `${repository.name}  /  ${repository.branches.length} branch copies`
            : 'One place to see what’s happening, and what happens next.';
  return (
    <div className={`app ${selected && isProjectView ? 'has-inspector' : ''}`}>
      <header className="titlebar">
        <div className="titlebar-spacer" />
        <button className="global-search" onClick={() => setSearchOpen(true)}>
          <Search size={14} />
          <span>Find a branch or task</span>
          <kbd>
            <Command size={10} />K
          </kbd>
        </button>
        <div className="connection-status">
          {mode === 'demo' ? (
            <span className="demo-indicator">DEMO WORKSPACE</span>
          ) : (
            <span>
              <i
                className={`status-dot ${gitNeedsSetup ? 'muted' : snapshot.scanning ? 'pulsing' : ''}`}
              />
              {gitNeedsSetup ? 'Git setup needed' : 'Local tracking'}
            </span>
          )}
          <span className="status-divider" />
          <span className="github-status">
            <Cloud size={14} />
            {mode === 'demo'
              ? 'Sample data'
              : providers.github.connected
                ? providers.github.login
                : providers.github.enabled
                  ? 'Public GitHub'
                  : 'Not connected'}
          </span>
          <button
            className={`refresh-button ${snapshot.scanning ? 'spinning' : ''}`}
            title="Refresh repositories"
            aria-label="Refresh repositories"
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      <Sidebar
        repositories={snapshot.repositories}
        selectedId={projectId}
        view={view}
        attentionCount={reviews.ready ? reviews.groups.active.length : 0}
        demo={mode === 'demo'}
        gitNeedsSetup={gitNeedsSetup}
        onProject={selectProject}
        onView={setView}
        onAdd={() => void addRepository()}
        onMode={switchMode}
      />
      <main className={`main ${firstSetup ? 'initial-setup' : ''}`}>
        <div className="page-header">
          <div className="breadcrumb">
            <span>Workspace</span>
            {repository && (
              <>
                <span>/</span>
                <button onClick={() => setView('map')}>{repository.name}</button>
              </>
            )}
            {view === 'attention' && (
              <>
                <span>/</span>
                <span>Needs attention</span>
              </>
            )}
          </div>
          <div className="page-title-row">
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {!repository && view === 'map' && (
              <button
                className="secondary-button add-project-button"
                onClick={() => void addRepository()}
                disabled={adding}
              >
                {adding ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Add
                project
              </button>
            )}
          </div>
          {isProjectView && (
            <div className="project-toolbar">
              <div className="view-switch" role="tablist" aria-label="Repository view">
                <button
                  role="tab"
                  aria-selected={view === 'map'}
                  className={view === 'map' ? 'selected' : ''}
                  onClick={() => setView('map')}
                >
                  <Map size={14} />
                  Map
                </button>
                <button
                  role="tab"
                  aria-selected={view === 'inventory'}
                  className={view === 'inventory' ? 'selected' : ''}
                  onClick={() => setView('inventory')}
                >
                  <List size={14} />
                  Branches<span>{repository.branches.length}</span>
                </button>
              </div>
              <span className="project-scan-status">
                <ShieldCheck size={13} />
                Read-only
              </span>
            </div>
          )}
        </div>
        {mode === 'live' &&
          gitNeedsSetup &&
          snapshot.repositories.length > 0 &&
          view !== 'settings' && (
            <div className="source-error">
              <span>
                Local inspection is paused until Git is ready. Your saved workspace is still
                available.
              </span>
              <button onClick={() => setView('settings')}>Set up Git</button>
            </div>
          )}
        {repository?.error && !gitNeedsSetup && (
          <div className="source-error">
            <span>Source unavailable. Showing the last snapshot.</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {repository?.github?.error && (
          <div className="source-error">
            <span>{repository.github.error} Showing the last GitHub snapshot.</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {repository?.github?.history &&
          repository.github.history.checked < repository.github.history.total &&
          !repository.github.error && (
            <div className="history-progress" role="status">
              GitHub history · {repository.github.history.checked} of{' '}
              {repository.github.history.total} comparisons checked.{' '}
              {repository.github.history.error ?? 'More load with each refresh as GitHub allows.'}
            </div>
          )}
        <div className="page-body">
          {loading ? (
            <EmptyState
              icon={LoaderCircle}
              title="Opening your workspace"
              description="Loading your last snapshot…"
            />
          ) : view === 'settings' ? (
            <Settings
              git={git}
              repositories={snapshot.repositories}
              demo={mode === 'demo'}
              onRemove={workspace.remove}
              onAdd={() => void addRepository()}
              onLive={switchMode}
            />
          ) : view === 'attention' ? (
            <Attention
              key={`${mode}:${projectId}`}
              reviews={reviews}
              repositoryId={projectId}
              repositories={snapshot.repositories}
              onSelect={navigateBranch}
              onSettings={() => setView('settings')}
              demo={mode === 'demo'}
            />
          ) : view === 'activity' ? (
            <section className="full-activity">
              <div className="section-kicker">
                <span>RECENT ACTIVITY</span>
                <span>{snapshot.events.length} events</span>
              </div>
              <ActivityList
                events={snapshot.events}
                repositories={snapshot.repositories}
                onSelect={navigateBranch}
              />
            </section>
          ) : !snapshot.repositories.length && mode === 'live' && gitNeedsSetup ? (
            <GitSetup
              git={git}
              onDemo={() => {
                setMode('demo');
                selectProject(null);
              }}
            />
          ) : !snapshot.repositories.length ? (
            <div className="welcome">
              <div className="welcome-map" aria-hidden="true">
                <span className="welcome-branch">
                  <GitBranch size={18} />
                  your next idea
                </span>
                <span className="welcome-line" />
                <span className="welcome-target">
                  <GitBranch size={16} />
                  develop
                </span>
              </div>
              <EmptyState
                icon={FolderPlus}
                title="Every branch has a story."
                description="Bring your projects together. See where your work lives, what’s ready, and what deserves a second look."
              >
                <button
                  className="primary-button"
                  onClick={() => void addRepository()}
                  disabled={adding}
                >
                  {adding ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}Add
                  your first project
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setMode('demo');
                    selectProject(null);
                  }}
                >
                  Take a look around first
                  <ArrowUpRight size={14} />
                </button>
              </EmptyState>
              <div className="welcome-trust">
                <ShieldCheck size={14} />
                Your repositories stay untouched. Everything starts read-only.
              </div>
            </div>
          ) : !repository ? (
            <Overview
              repositories={snapshot.repositories}
              events={snapshot.events}
              onProject={(id) => {
                selectProject(id);
                setView('map');
              }}
              onActivity={() => setView('activity')}
              onSelect={navigateBranch}
              onAdd={() => void addRepository()}
            />
          ) : view === 'inventory' ? (
            <Inventory
              key={repository.id}
              repository={repository}
              branches={repository.branches}
              selectedId={selectedId}
              onSelect={selectBranch}
            />
          ) : (
            <div className="map-content">
              <div className="lifecycle-tabs" role="tablist" aria-label="Branch groups">
                {(Object.keys(lifecycleLabels) as Lifecycle[]).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={group === value}
                    className={`${value} ${group === value ? 'selected' : ''}`}
                    onClick={() => setGroup(value)}
                  >
                    <i />
                    <span>{lifecycleLabels[value]}</span>
                    <b>{counts[value]}</b>
                  </button>
                ))}
              </div>
              <div className="group-context">
                <span>
                  Showing {grouped.length} of {branches.length} working branches <i />{' '}
                  {branches.length - grouped.length} in other groups
                </span>
                <button className="text-button" onClick={() => setView('inventory')}>
                  View all branches
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <BranchMap
                key={`${repository.id}:${group}`}
                repository={repository}
                branches={grouped}
                selectedId={selectedId}
                onSelect={selectBranch}
                onInventory={() => setView('inventory')}
              />
              <div className="map-bottom-note">
                <span>
                  <Sparkles size={13} />
                  Expand a little. Understand a lot.
                </span>
                <span>Quiet doesn’t mean finished.</span>
              </div>
            </div>
          )}
        </div>
        <footer className="app-footer">
          <span>
            <i className={`status-dot ${mode === 'demo' ? 'muted' : ''}`} />
            {mode === 'demo'
              ? 'Fictional projects · explore freely'
              : gitNeedsSetup
                ? 'Local inspection paused · finish Git setup in Settings'
                : `${snapshot.repositories.length} repositories · watching while open`}
          </span>
          <span>Made for a clearer headspace.</span>
        </footer>
      </main>
      {selected && repository && isProjectView && (
        <Inspector
          branch={selected}
          repository={repository}
          demo={mode === 'demo'}
          close={() => setSelectedId(null)}
          onError={setError}
        />
      )}
      {searchOpen && (
        <SearchDialog
          repositories={snapshot.repositories}
          close={() => setSearchOpen(false)}
          select={navigateBranch}
        />
      )}
      {error && (
        <div className="toast" role="status">
          <span>{error}</span>
          <IconButton icon={X} label="Dismiss message" onClick={() => setError(null)} />
        </div>
      )}
    </div>
  );
}
