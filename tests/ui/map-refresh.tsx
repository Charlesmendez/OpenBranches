// Fictional UI regression surface. No desktop API or personal repository access.
import { createRoot } from 'react-dom/client';
import { useEffect, useState, StrictMode } from 'react';
import { BranchMap } from '../../src/ui/components/BranchMap';
import { createDemoSnapshot } from '../../src/data/demo';
import type { MapPosition } from '../../src/ui/navigation';
import '../../src/ui/styles.css';
import '../../src/ui/components/workflow.css';
const original = createDemoSnapshot().repositories[0];
function Fixture() {
  const [repository, setRepository] = useState(original);
  const [position, setPosition] = useState<MapPosition>({
    expanded: 'tracked',
    page: 0,
    viewport: { x: 40000, y: 40000, zoom: 1 },
  });
  const [running, setRunning] = useState(false),
    [ticks, setTicks] = useState(0),
    [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setRepository((r) => ({
        ...r,
        branches: r.branches.map((b) => ({ ...b })),
        scannedAt: new Date().toISOString(),
      }));
      setTicks((n) => n + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [running]);
  return (
    <main
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <strong>Map refresh regression · fictional data</strong>
        <button className="secondary-button" onClick={() => setRunning((v) => !v)}>
          {running ? 'Stop refreshes' : 'Start refreshes'}
        </button>
        <button className="secondary-button" onClick={() => setVisible((v) => !v)}>
          {visible ? 'Leave map' : 'Return to map'}
        </button>
        <output>Refreshes: {ticks}</output>
        <output>Selected: {selected ?? 'none'}</output>
      </div>
      {visible && (
        <BranchMap
          repository={repository}
          branches={repository.branches}
          selectedId={selected}
          onSelect={(b) => setSelected(b.id)}
          onInventory={() => {}}
          initialPosition={position}
          remember={setPosition}
          onScopeChange={() => setSelected(null)}
        />
      )}
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
