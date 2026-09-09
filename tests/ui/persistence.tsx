// Development-only fixture: all workspace updates are fictional. Storage uses
// a separate fixture prefix; no repository, provider, or desktop action runs.
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import type { DesktopApi, Snapshot } from '../../src/domain/types';
import { createDemoSnapshot } from '../../src/data/demo';
import { NavigationMemory } from '../../src/ui/navigationMemory';
import { useProjectMemory } from '../../src/ui/hooks/useProjectMemory';
import { useWorkspace } from '../../src/ui/hooks/useWorkspace';
import '../../src/ui/styles.css';

const sample = createDemoSnapshot(1_783_000_000_000);
const repository = sample.repositories[0];
const empty = { ...sample, repositories: [], events: [] };
const pending: { resolve: (snapshot: Snapshot) => void; reject: () => void }[] = [];
const listeners = new Set<(snapshot: Snapshot) => void>();
window.openbranches = {
  getSnapshot: () =>
    new Promise((resolve, reject) =>
      pending.push({ resolve, reject: () => reject(new Error('Fictional load failure')) }),
    ),
  onSnapshot: (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
} as DesktopApi;
const storage = {
  getItem: (key: string) => localStorage.getItem(`fixture-${key}`),
  setItem: (key: string, value: string) => localStorage.setItem(`fixture-${key}`, value),
};

function WorkspaceFixture() {
  const [positions] = useState(() => new NavigationMemory(() => storage));
  const workspace = useWorkspace('live');
  const memory = useProjectMemory(
    'live',
    workspace.snapshot.repositories,
    workspace.loading || !workspace.ready,
    positions,
  );
  const [inspection, setInspection] = useState('');
  const old = useRef<() => void>(() => {});
  return (
    <>
      <p role="status">
        {workspace.loading
          ? 'Loading'
          : workspace.ready
            ? `Loaded ${workspace.snapshot.repositories.length} projects`
            : 'Load failed; saved positions protected'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button
          className="secondary-button"
          onClick={() => {
            positions.remember('live', repository.id, {
              selectedId: 'saved-fixture-branch',
              group: 'quiet',
            });
            positions.rememberWorkspace('live', { projectId: repository.id, view: 'inventory' });
            positions.flush();
          }}
        >
          Seed saved view
        </button>
        <button className="secondary-button" onClick={() => pending.shift()?.reject()}>
          Fail pending load
        </button>
        <button className="secondary-button" onClick={() => pending.shift()?.resolve(empty)}>
          Deliver older empty load
        </button>
        <button
          className="secondary-button"
          onClick={() => listeners.forEach((listener) => listener(sample))}
        >
          Publish current fixture
        </button>
        <button
          className="secondary-button"
          onClick={() => listeners.forEach((listener) => listener(empty))}
        >
          Publish empty fixture
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            old.current = () => memory.remember(repository.id, { selectedId: 'stale-callback' });
          }}
        >
          Capture old callback
        </button>
        <button className="secondary-button" onClick={() => old.current()}>
          Run old callback
        </button>
        <button className="secondary-button" onClick={() => void workspace.reload()}>
          Request another load
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            setInspection(
              JSON.stringify(
                {
                  route: positions.workspace('live'),
                  position: positions.read('live', repository.id),
                },
                null,
                2,
              ),
            )
          }
        >
          Inspect saved view
        </button>
      </div>
      <pre aria-label="Saved view">{inspection}</pre>
    </>
  );
}
function Fixture() {
  const [generation, setGeneration] = useState(0);
  return (
    <main style={{ maxWidth: 900, margin: '80px auto', display: 'grid', gap: 24 }}>
      <h1>Saved position lifecycle</h1>
      <p>Fictional workspace updates. Resolve or fail each pending load explicitly.</p>
      <button
        className="secondary-button"
        onClick={() => {
          pending.length = 0;
          setGeneration((value) => value + 1);
        }}
      >
        Restart fixture
      </button>
      <WorkspaceFixture key={generation} />
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
