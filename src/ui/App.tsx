import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Command,
  FolderPlus,
  GitBranch,
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
import type { Branch, Lifecycle, Repository, View } from '../domain/types';
import { featureBranches, groupCounts, lifecycleLabels, lifecycleOf } from '../domain/branches';
import { useWorkspace } from './hooks/useWorkspace';
import { useProviders } from './hooks/useProviders';
import { useGit } from './hooks/useGit';
import { useReviews } from './hooks/useReviews';
import { useProjectMemory } from './hooks/useProjectMemory';
import { mapPositionFor, revealSelection } from './navigation';
import { NavigationMemory, type WorkspaceMode } from './navigationMemory';
import { GitSetup } from './components/GitSetup';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { BranchMap } from './components/BranchMap';
import { Inventory } from './components/Inventory';
import { Inspector } from './components/Inspector';
import { Attention } from './components/Attention';
import { SearchDialog } from './components/SearchDialog';
import { Settings } from './components/Settings';
import { EmptyState, IconButton } from './components/Primitives';
import { triageFindings } from '../domain/triage';
import { ProjectWorkSpotlight } from './components/ProjectWorkSpotlight';
import { ProjectActivityStatus } from './components/ProjectActivityStatus';
import { SourceStatusMenu } from './components/SourceStatusMenu';

const People = lazy(() =>
  import('./components/People').then((module) => ({ default: module.People })),
);
const Activity = lazy(() =>
  import('./components/Activity').then((module) => ({ default: module.Activity })),
);

export function App() {
  const [positions] = useState(() => new NavigationMemory(() => window.localStorage));
  const workspace = useWorkspace(positions.initialMode(!!window.openbranches));
  const providers = useProviders();
  const git = useGit();
  const gitNeedsSetup = !!git.status && git.status.state !== 'ready';
  const { snapshot, mode, setMode, error, setError, loading, adding, add, refresh } = workspace;
  const reviews = useReviews(mode === 'demo', snapshot.repositories);
  const memory = useProjectMemory(
    mode,
    snapshot.repositories,
    loading || !workspace.ready,
    positions,
  );
  const initial = positions.workspace(mode);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [view, setView] = useState<View>(initial.view);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initial.projectId ? positions.read(mode, initial.projectId).selectedId : null,
  );
  const [group, setGroup] = useState<Lifecycle>(() =>
    initial.projectId ? positions.read(mode, initial.projectId).group : 'active',
  );
  const [restoredMode, setRestoredMode] = useState<WorkspaceMode | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [settingsFocus, setSettingsFocus] = useState<'live-activity'>();
  const selectionOrigin = useRef<HTMLElement | null>(null);
  const closeDetails = () => {
    const fallback = selectedId
      ? document.querySelector<HTMLElement>(`[data-branch-id="${CSS.escape(selectedId)}"]`)
      : null;
    setSelectedId(null);
    requestAnimationFrame(() => {
      const target = selectionOrigin.current?.isConnected ? selectionOrigin.current : fallback;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  };
  const repository = snapshot.repositories.find((r) => r.id === projectId);
  const branches = useMemo(() => (repository ? featureBranches(repository) : []), [repository]);
  const counts = useMemo(() => groupCounts(branches), [branches]);
  const grouped = useMemo(
    () => branches.filter((branch) => lifecycleOf(branch) === group),
    [branches, group],
  );
  const selected = repository?.branches.find((branch) => branch.id === selectedId);
  useLayoutEffect(() => {
    if (loading || !workspace.ready || restoredMode === mode) return;
    if (repository) {
      const restored = revealSelection(
        { ...memory.read(repository.id), selectedId: selected?.id ?? null },
        branches,
      );
      memory.remember(repository.id, restored);
      setSelectedId(restored.selectedId);
      setGroup(restored.group);
    } else {
      setProjectId(null);
      setSelectedId(null);
      setGroup('active');
    }
    setRestoredMode(mode);
  }, [loading, workspace.ready, mode, restoredMode, repository, selected, branches]);
  useEffect(() => {
    if (repository && selectedId && !selected) closeDetails();
  }, [repository, selectedId, selected]);
  useEffect(() => {
    if (loading || !workspace.ready || restoredMode !== mode) return;
    if (repository) memory.remember(repository.id, { selectedId: selected?.id ?? null, group });
    positions.rememberWorkspace(mode, { projectId: repository?.id ?? null, view });
  }, [
    projectId,
    mode,
    selectedId,
    group,
    view,
    loading,
    workspace.ready,
    restoredMode,
    !!repository,
  ]);
  useEffect(() => {
    if (
      !loading &&
      workspace.ready &&
      projectId &&
      !snapshot.repositories.some((repository) => repository.id === projectId)
    ) {
      setProjectId(null);
      setSelectedId(null);
    }
  }, [loading, workspace.ready, projectId, snapshot.repositories]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setSearchOpen(false);
        closeDetails();
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
    const target = snapshot.repositories.find((repository) => repository.id === id);
    const saved =
      id && target ? revealSelection(memory.read(id), featureBranches(target)) : undefined;
    if (id && saved) memory.remember(id, saved);
    setProjectId(id);
    setSelectedId(saved?.selectedId ?? null);
    setGroup(saved?.group ?? 'active');
  };
  const selectBranch = (branch: Branch) => {
    const active = document.activeElement;
    selectionOrigin.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setSelectedId(branch.id);
  };
  const focusRepositoryBranch = (targetRepository: Repository, branch: Branch) => {
    const nextGroup = lifecycleOf(branch);
    const targetBranches = featureBranches(targetRepository);
    const nextBranches = targetBranches.filter((candidate) => lifecycleOf(candidate) === nextGroup);
    const mapPosition = mapPositionFor(nextBranches, branch.id, targetRepository.path);
    if (mapPosition)
      memory.remember(targetRepository.id, {
        maps: { ...memory.read(targetRepository.id).maps, [nextGroup]: mapPosition },
      });
    setNavigationRequest((request) => request + 1);
    setProjectId(targetRepository.id);
    setView('map');
    setGroup(nextGroup);
    selectBranch(branch);
  };
  const focusMapBranch = (branch: Branch) => {
    if (repository) focusRepositoryBranch(repository, branch);
  };
  const navigateBranch = (repoId: string, branchId?: string) => {
    memory.remember(repoId, { inventory: undefined });
    setNavigationRequest((request) => request + 1);
    setProjectId(repoId);
    setSelectedId(branchId ?? null);
    setGroup(memory.read(repoId).group);
    setView(branchId ? 'inventory' : 'map');
  };
  const changeView = (next: View) => {
    if (next === 'map' && repository && selected) {
      const restored = revealSelection({ ...memory.read(repository.id), selectedId }, branches);
      memory.remember(repository.id, restored);
      setGroup(restored.group);
    }
    setSettingsFocus(undefined);
    setView(next);
  };
  const openSettings = (focus?: 'live-activity') => {
    setSettingsFocus(focus);
    setView('settings');
  };
  const addRepository = async () => {
    if (gitNeedsSetup) {
      openSettings();
      return;
    }
    const added = await add();
    if (added) {
      selectProject(added.id);
      setView('map');
    }
  };
  const switchMode = () => {
    const next = mode === 'demo' ? 'live' : 'demo';
    if (next === 'live' && !window.openbranches) {
      setError(
        'Open the desktop app to connect your projects. This browser preview uses demo data.',
      );
      return;
    }
    if (workspace.ready) positions.rememberWorkspace(mode, { projectId, view });
    const route = positions.workspace(next);
    positions.rememberWorkspace(next, route);
    const saved = route.projectId ? positions.read(next, route.projectId) : undefined;
    setMode(next);
    setProjectId(route.projectId);
    setView(route.view);
    setSelectedId(saved?.selectedId ?? null);
    setGroup(saved?.group ?? 'active');
  };
  const isProjectView = repository && ['map', 'inventory'].includes(view);
  const firstSetup =
    !loading &&
    mode === 'live' &&
    gitNeedsSetup &&
    !snapshot.repositories.length &&
    ['map', 'inventory'].includes(view);
  const title =
    view === 'people'
      ? 'The people behind the work.'
      : view === 'settings'
        ? 'Make yourself at home.'
        : view === 'attention'
          ? 'Decide what happens next.'
          : view === 'activity'
            ? 'The work keeps moving.'
            : repository
              ? view === 'inventory'
                ? 'Find your thread.'
                : 'Follow the work.'
              : 'A pulse on every project.';
  const subtitle =
    view === 'people'
      ? 'Pull requests and review requests across your connected projects.'
      : view === 'settings'
        ? 'Your connections, your data, your way of working.'
        : view === 'attention'
          ? 'A short starting list. The rest is organized into review queues.'
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
            <>
              <span className="demo-indicator">DEMO WORKSPACE</span>
              <span className="status-divider" />
              <span className="github-status">Sample data</span>
            </>
          ) : (
            <SourceStatusMenu
              repositories={snapshot.repositories}
              providers={providers}
              gitState={git.status?.state ?? 'checking'}
              scanning={snapshot.scanning}
              onSettings={() => openSettings()}
            />
          )}
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
        attentionCount={
          reviews.ready
            ? new Set(
                triageFindings(reviews.groups.active, snapshot.repositories).map(
                  (item) => item.queue,
                ),
              ).size
            : 0
        }
        demo={mode === 'demo'}
        gitNeedsSetup={gitNeedsSetup}
        onProject={selectProject}
        onView={changeView}
        onAdd={() => void addRepository()}
        onMode={switchMode}
        teamApi={mode === 'live' ? window.openbranches?.teams : undefined}
        onError={setError}
      />
      <main className={`main ${firstSetup ? 'initial-setup' : ''}`}>
        <div className="page-header">
          <div className="breadcrumb">
            <span>Workspace</span>
            {repository && view !== 'people' && view !== 'activity' && (
              <>
                <span>/</span>
                <button onClick={() => changeView('map')}>{repository.name}</button>
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
                  onClick={() => changeView('map')}
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
              <div className="project-toolbar-statuses">
                <ProjectActivityStatus
                  branches={branches}
                  repositoryPath={repository.path}
                  providers={providers}
                  showCurrent={view === 'inventory'}
                  onFocus={focusMapBranch}
                  onSettings={() => openSettings('live-activity')}
                />
                <span className="project-scan-status">
                  <ShieldCheck size={13} />
                  Read-only
                </span>
              </div>
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
              <button onClick={() => openSettings()}>Set up Git</button>
            </div>
          )}
        {repository?.error && !gitNeedsSetup && view !== 'people' && view !== 'activity' && (
          <div className="source-error">
            <span>Source unavailable. Showing the last snapshot.</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {repository?.github?.error && view !== 'people' && view !== 'activity' && (
          <div className="source-error">
            <span>{repository.github.error} Showing the last GitHub snapshot.</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {view !== 'people' &&
          view !== 'activity' &&
          repository?.github?.history &&
          repository.github.history.checked < repository.github.history.total &&
          !repository.github.error && (
            <div className="history-progress" role="status">
              GitHub history · {repository.github.history.checked} of{' '}
              {repository.github.history.total} comparisons checked.{' '}
              {repository.github.history.error ?? 'More load with each refresh as GitHub allows.'}
            </div>
          )}
        {memory.notice && (
          <div className="source-error" role="status">
            <span>{memory.notice}</span>
            <button onClick={memory.retrySave}>Save current view</button>
          </div>
        )}
        <div className="page-body">
          {loading || (workspace.ready && restoredMode !== mode) ? (
            <EmptyState
              icon={LoaderCircle}
              title="Opening your workspace"
              description="Loading your last snapshot…"
            />
          ) : !workspace.ready ? (
            <EmptyState
              icon={RefreshCw}
              title="Your workspace couldn’t be loaded"
              description="Your saved place is still here. Try loading the workspace again."
            >
              <button className="secondary-button" onClick={() => void workspace.reload()}>
                Try again
              </button>
            </EmptyState>
          ) : view === 'settings' ? (
            <Settings
              git={git}
              repositories={snapshot.repositories}
              demo={mode === 'demo'}
              onRemove={workspace.remove}
              onAdd={() => void addRepository()}
              onLive={switchMode}
              focusSection={settingsFocus}
            />
          ) : view === 'people' ? (
            <Suspense
              fallback={
                <EmptyState
                  icon={LoaderCircle}
                  title="Opening collaboration"
                  description="Loading the people view…"
                />
              }
            >
              <People
                key={mode}
                navigation={positions}
                mode={mode}
                repositories={snapshot.repositories}
                demo={mode === 'demo'}
                onSelect={navigateBranch}
                onSettings={() => openSettings()}
              />
            </Suspense>
          ) : view === 'attention' ? (
            <Attention
              key={`${mode}:${projectId}`}
              reviews={reviews}
              repositoryId={projectId}
              repositories={snapshot.repositories}
              onSelect={navigateBranch}
              onSettings={() => openSettings()}
              demo={mode === 'demo'}
              codex={providers.codex}
            />
          ) : view === 'activity' ? (
            <Suspense
              fallback={
                <EmptyState
                  icon={LoaderCircle}
                  title="Opening activity"
                  description="Loading your local timeline…"
                />
              }
            >
              <Activity
                key={mode}
                events={snapshot.events}
                repositories={snapshot.repositories}
                demo={mode === 'demo'}
                navigation={positions}
                mode={mode}
                onSelect={navigateBranch}
              />
            </Suspense>
          ) : !snapshot.repositories.length && mode === 'live' && gitNeedsSetup ? (
            <GitSetup git={git} onDemo={switchMode} />
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
                <button className="primary-button" onClick={() => openSettings()}>
                  Find my Codex projects
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void addRepository()}
                  disabled={adding}
                >
                  {adding ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}Choose
                  a folder
                </button>
                <button className="text-button" onClick={switchMode}>
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
              onFocus={focusRepositoryBranch}
              onAdd={() => void addRepository()}
            />
          ) : view === 'inventory' ? (
            <Inventory
              key={`${mode}:${repository.id}:${navigationRequest}`}
              repository={repository}
              branches={repository.branches}
              selectedId={selectedId}
              onSelect={selectBranch}
              initialPosition={memory.read(repository.id).inventory}
              remember={(inventory) => memory.remember(repository.id, { inventory })}
              onFocus={(element) => {
                selectionOrigin.current = element;
              }}
            />
          ) : (
            <div className="map-content">
              <ProjectWorkSpotlight
                repository={repository}
                branches={branches}
                onFocus={focusMapBranch}
              />
              <div className="lifecycle-tabs" role="tablist" aria-label="Branch groups">
                {(Object.keys(lifecycleLabels) as Lifecycle[]).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={group === value}
                    className={`${value} ${group === value ? 'selected' : ''}`}
                    onClick={() => {
                      setGroup(value);
                      setSelectedId(null);
                    }}
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
                key={`${repository.id}:${group}:${navigationRequest}`}
                repository={repository}
                branches={grouped}
                selectedId={selectedId}
                onSelect={selectBranch}
                onInventory={() => setView('inventory')}
                initialPosition={
                  memory.read(repository.id).maps[group] ?? mapPositionFor(grouped, selectedId)
                }
                remember={(position) =>
                  memory.remember(repository.id, {
                    maps: { ...memory.read(repository.id).maps, [group]: position },
                  })
                }
                onScopeChange={() => setSelectedId(null)}
                liveState={
                  mode === 'demo' ? 'connected' : (providers.codex.liveState ?? 'unavailable')
                }
              />
              <div className="map-bottom-note">
                <span>
                  <Sparkles size={13} />
                  Each target is checked independently.
                </span>
                <span>Missing history does not rule out a squash merge.</span>
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
          close={closeDetails}
          onError={setError}
        />
      )}
      {searchOpen && (
        <SearchDialog
          repositories={snapshot.repositories}
          close={() => setSearchOpen(false)}
          focus={focusRepositoryBranch}
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
