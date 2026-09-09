// Development-only browser fixture. Every desktop operation is simulated;
// this file is not an entry point in the production build.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { App } from '../../src/ui/App';
import type { GitStatus, Snapshot } from '../../src/domain/types';
import { createDemoSnapshot } from '../../src/data/demo';
import '../../src/ui/styles.css';

let status: GitStatus = {
  state: 'missing',
  installAvailable: true,
  message:
    'Git reads the branch history in your projects. Apple includes it in a free package called Command Line Tools.',
};
let snapshot: Snapshot = {
  repositories: [],
  events: [],
  updatedAt: new Date().toISOString(),
  scanning: false,
};
let failInstaller = false;
const gitListeners = new Set<(status: GitStatus) => void>();
const snapshotListeners = new Set<(snapshot: Snapshot) => void>();
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
    snapshot = { ...snapshot, repositories: [repository] };
    snapshotListeners.forEach((listener) => listener(snapshot));
    return repository;
  },
  removeRepository: async () => {},
  refresh: async () => {},
  revealWorktree: async () => {},
  openExternal: async () => {},
  getProviderStatus: async () => ({
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
        <strong>Simulated setup</strong>
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
      </aside>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
