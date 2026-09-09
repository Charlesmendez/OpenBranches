// Fictional, development-only inventory. All refresh controls change React
// fixture state; no desktop APIs, repositories, or provider requests are used.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Inventory } from '../../src/ui/components/Inventory';
import { createDemoSnapshot } from '../../src/data/demo';
import type { InventoryPosition } from '../../src/ui/navigation';
import '../../src/ui/styles.css';

const repository = createDemoSnapshot().repositories[0];
repository.targets = ['develop', 'dev', 'main', 'master'].map((name) => ({
  name,
  sha: 'a'.repeat(40),
  source: 'local',
}));
const original = Array.from({ length: 1000 }, (_, index) => ({
  ...repository.branches[index % repository.branches.length],
  id: `navigation-fixture:${index}`,
  title: `Work ${String(index + 1).padStart(4, '0')}`,
  name: `codex/fixture-${index + 1}`,
  updatedAt: new Date(Date.now() - index * 60_000).toISOString(),
}));
function Fixture() {
  const [branches, setBranches] = useState(original);
  const [selected, setSelected] = useState<string | null>(null);
  const [position, setPosition] = useState<InventoryPosition>();
  const [visible, setVisible] = useState(true);
  return (
    <main
      style={{
        width: 710,
        height: '100vh',
        margin: '0 auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong>1,000 fictional branches</strong>
        <button className="secondary-button" onClick={() => setVisible(!visible)}>
          {visible ? 'Leave inventory' : 'Return to inventory'}
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            setBranches((current) => [
              {
                ...original[0],
                id: `new:${current.length}`,
                title: 'Newest work',
                updatedAt: new Date().toISOString(),
              },
              ...current,
            ])
          }
        >
          Simulate new work
        </button>
      </div>
      <output>Selected: {selected ?? 'none'}</output>
      <div style={{ flex: 1, minHeight: 0 }}>
        {visible ? (
          <Inventory
            repository={repository}
            branches={branches}
            selectedId={selected}
            onSelect={(branch) => setSelected(branch.id)}
            initialPosition={position}
            remember={setPosition}
          />
        ) : (
          <p>View position is kept while this inventory is unmounted.</p>
        )}
      </div>
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
