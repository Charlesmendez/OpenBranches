import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createDemoSnapshot } from '../../src/data/demo';
import { TeamConnectionsPanel } from '../../src/ui/components/TeamConnections';
import { Brand } from '../../src/ui/components/Primitives';
import '../../src/ui/styles.css';
import type { Snapshot } from '../../src/domain/types';
declare global {
  interface Window {
    openbranchesFixture?: {
      snapshot(): Promise<Snapshot>;
      change(): Promise<Snapshot>;
      restart(): Promise<void>;
    };
  }
}
function Fixture() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    void window.openbranchesFixture?.snapshot().then(setSnapshot);
  }, []);
  return (
    <main style={{ maxWidth: 1100, margin: 'auto', padding: 35 }}>
      <Brand />
      <p className="muted-note">
        FICTIONAL MAC PREVIEW · Separate temporary storage · No real repository scans
      </p>
      {window.openbranchesFixture && (
        <div className="mac-team-actions">
          <button
            className="secondary-button"
            onClick={() => void window.openbranchesFixture!.change().then(setSnapshot)}
          >
            Simulate a local commit
          </button>
          <button
            className="secondary-button"
            onClick={() => void window.openbranchesFixture!.restart()}
          >
            Restart fictional Mac
          </button>
        </div>
      )}
      <div style={{ marginTop: 30 }}>
        <TeamConnectionsPanel
          demo={false}
          repositories={(snapshot ?? createDemoSnapshot()).repositories}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
