// Development-only browser fixture. Every desktop operation is simulated;
// this file is not an entry point in the production build.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { App } from '../../src/ui/App';
import type {
  GitStatus,
  Snapshot,
  ProjectDiscoveryState,
  AgentHistoryStatus,
  AgentLiveStatus,
} from '../../src/domain/types';
import { createDemoSnapshot } from '../../src/data/demo';
import '../../src/ui/styles.css';
import '../../src/ui/components/workflow.css';

const discoveryFixture = new URLSearchParams(location.search).has('discovery');
const quietFixture = new URLSearchParams(location.search).has('quiet');
let status: GitStatus = {
  state: 'missing',
  installAvailable: true,
  message:
    'Git reads the branch history in your projects. Apple includes it in a free package called Command Line Tools.',
};
if (discoveryFixture) status = { state: 'ready', version: '2.53.0', installAvailable: false };
let snapshot: Snapshot = {
  repositories: [],
  events: [],
  updatedAt: new Date().toISOString(),
  scanning: false,
};
let failInstaller = false;
const gitListeners = new Set<(status: GitStatus) => void>();
const snapshotListeners = new Set<(snapshot: Snapshot) => void>();
const discoveryListeners = new Set<(state: ProjectDiscoveryState) => void>();
let agents: AgentHistoryStatus[] = [
  { tool: 'claude-code', enabled: false, state: 'not-connected' },
];
const agentListeners = new Set<(statuses: AgentHistoryStatus[]) => void>();
let liveAgents: AgentLiveStatus[] = [
  {
    tool: 'codex',
    enabled: false,
    installed: false,
    state: 'not-connected',
    activeCount: 0,
  },
  {
    tool: 'claude-code',
    enabled: false,
    installed: false,
    state: 'not-connected',
    activeCount: 0,
  },
  {
    tool: 'cursor',
    enabled: false,
    installed: false,
    state: 'not-connected',
    activeCount: 0,
  },
];
const liveAgentListeners = new Set<(statuses: AgentLiveStatus[]) => void>();
const excluded = new Set<string>();
const names = [
  'Atlas API',
  'Relay',
  'Studio',
  'Café Backend',
  'Beacon',
  'Northstar',
  'Marina',
  'Orbit',
  'Lighthouse',
  'Compass',
  'Harbor',
  'Aurora',
];
const candidates = names.map((name, index) => ({
  ...createDemoSnapshot().repositories[0],
  id: `discovery-fixture-${index}`,
  name,
  path: `/fictional/projects/${name}`,
  branches: [],
  worktrees: [],
}));
let discovery: ProjectDiscoveryState = {
  enabled: false,
  scanning: false,
  projects: discoveryFixture
    ? candidates.map((repository) => ({
        id: repository.id,
        name: repository.name,
        path: repository.path,
        source: 'codex',
        available: true,
      }))
    : [],
  excludedCount: 0,
  failedCount: 0,
  pendingCount: 0,
};
function refreshDiscovery() {
  discovery = { ...discovery, excludedCount: excluded.size, checkedAt: new Date().toISOString() };
  if (discovery.enabled) {
    const known = new Set(snapshot.repositories.map((repository) => repository.id));
    snapshot = {
      ...snapshot,
      repositories: [
        ...snapshot.repositories,
        ...candidates.filter(
          (repository) => !known.has(repository.id) && !excluded.has(repository.id),
        ),
      ],
    };
    snapshotListeners.forEach((listener) => listener(snapshot));
  }
  discoveryListeners.forEach((listener) => listener(discovery));
}
let installCalls = 0;
let addCalls = 0;
let guideCalls = 0;
let updateCounters = () => {};
const subscribe = <T,>(listeners: Set<(value: T) => void>, listener: (value: T) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
window.openbranches = {
  setAgentHistoryEnabled: async (tool, enabled) => {
    agents = [{ tool, enabled, state: enabled ? 'ready' : 'not-connected', taskCount: 0 }];
    agentListeners.forEach((listener) => listener(agents));
  },
  onAgentHistory: (listener) => subscribe(agentListeners, listener),
  setAgentLiveEnabled: async (tool, enabled) => {
    liveAgents = liveAgents.map((status) =>
      status.tool === tool
        ? {
            ...status,
            enabled,
            installed: enabled,
            state: enabled ? 'listening' : 'not-connected',
          }
        : status,
    );
    liveAgentListeners.forEach((listener) => listener(liveAgents));
    return liveAgents;
  },
  onAgentLive: (listener) => subscribe(liveAgentListeners, listener),
  getDiscoveredProjects: async () => discovery,
  followDiscoveredProjects: async (enabled) => {
    discovery = { ...discovery, enabled };
    refreshDiscovery();
  },
  refreshDiscoveredProjects: async () => {
    refreshDiscovery();
  },
  restoreDiscoveredProjects: async () => {
    excluded.clear();
    refreshDiscovery();
  },
  onDiscoveredProjects: (listener) => subscribe(discoveryListeners, listener),
  openCodexTask: async () => 'not-linked',
  getHandoffs: async () => ({
    providers: [
      { provider: 'codex', label: 'Codex', installed: true },
      { provider: 'claude-code', label: 'Claude', installed: true },
      { provider: 'cursor', label: 'Cursor', installed: true },
    ],
    handoffs: [],
  }),
  previewHandoff: async () => {
    throw new Error('The fixture has no live branch evidence.');
  },
  sendHandoff: async () => ({
    ok: false,
    createdIds: [],
    state: { providers: [], handoffs: [] },
  }),
  onHandoffs: () => () => {},
  getReviews: async () => ({ decisions: [] }),
  decideReview: async () => ({ ok: false, state: { decisions: [] } }),
  resetReviews: async () => ({ ok: true, state: { decisions: [] } }),
  onReviews: () => () => {},
  checkGit: async () => status,
  installGit: async () => {
    installCalls++;
    updateCounters();
    if (failInstaller)
      throw new Error(
        'Apple’s installer could not be opened. If installation is already in progress, let it finish and check again. Otherwise, open the setup guide.',
      );
  },
  openGitSetupGuide: async () => {
    guideCalls++;
    updateCounters();
  },
  onGit: (listener) => subscribe(gitListeners, listener),
  getSnapshot: async () => snapshot,
  addRepository: async () => {
    addCalls++;
    updateCounters();
    const repository = createDemoSnapshot().repositories[0];
    if (quietFixture)
      repository.branches = repository.branches.map((branch) => ({
        ...branch,
        tasks: branch.tasks?.map(({ activitySource: _, waiting: __, ...task }) => ({
          ...task,
          status: 'idle',
        })),
      }));
    snapshot = { ...snapshot, repositories: [repository] };
    snapshotListeners.forEach((listener) => listener(snapshot));
    return repository;
  },
  removeRepository: async (id) => {
    excluded.add(id);
    snapshot = {
      ...snapshot,
      repositories: snapshot.repositories.filter((repository) => repository.id !== id),
      events: snapshot.events.filter((event) => event.repositoryId !== id),
    };
    snapshotListeners.forEach((listener) => listener(snapshot));
    refreshDiscovery();
  },
  refresh: async () => {},
  revealWorktree: async () => {},
  openExternal: async () => {},
  getProviderStatus: async () => ({
    agents,
    liveAgents,
    codex: { installed: false, enabled: false, state: 'not-connected' },
    github: { connected: false, configured: false },
  }),
  connectGitHub: async () => ({ connected: false, configured: false }),
  pollGitHub: async () => ({ connected: false, configured: false }),
  disconnectGitHub: async () => {},
  enablePublicGitHub: async () => {},
  connectCodex: async () => {},
  disconnectCodex: async () => {},
  onCodex: () => () => {},
  onGitHub: () => () => {},
  onSnapshot: (listener) => subscribe(snapshotListeners, listener),
};
function Fixture() {
  const [, renderCounters] = useState(0);
  updateCounters = () => renderCounters((value) => value + 1);
  const change = (next: GitStatus) => {
    status = next;
    gitListeners.forEach((listener) => listener(next));
  };
  return (
    <>
      <App />
      <aside
        aria-label="Fixture controls"
        style={{
          position: 'fixed',
          bottom: 8,
          right: 12,
          zIndex: 50,
          background: '#322941',
          border: '1px solid #8871a9',
          borderRadius: 8,
          padding: 8,
          fontSize: 11,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <strong>
          {discoveryFixture
            ? 'Simulated project discovery · fictional folders only'
            : 'Simulated setup'}
        </strong>
        {!discoveryFixture && (
          <>
            <button
              onClick={() => change({ state: 'ready', version: '2.53.0', installAvailable: false })}
            >
              Finish installation
            </button>
            <button
              onClick={() => {
                failInstaller = true;
                change({
                  state: 'missing',
                  installAvailable: true,
                  message: 'Git is missing. Install Apple’s Command Line Tools to get started.',
                });
              }}
            >
              Installer failure
            </button>
            <button
              onClick={() =>
                change({
                  state: 'unsupported',
                  version: '2.35.0',
                  installAvailable: false,
                  message:
                    'OpenBranches needs Git 2.36.0 or newer to read worktree paths reliably. Update Git or Apple’s Command Line Tools, then check again.',
                })
              }
            >
              Old Git
            </button>
            <output>
              Installer: {installCalls} · Folders: {addCalls} · Guide: {guideCalls}
            </output>
          </>
        )}
      </aside>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
