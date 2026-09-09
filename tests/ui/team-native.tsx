import { createRoot } from 'react-dom/client';
import { createDemoSnapshot } from '../../src/data/demo';
import { TeamConnectionsPanel } from '../../src/ui/components/TeamConnections';
import { Brand } from '../../src/ui/components/Primitives';
import '../../src/ui/styles.css';
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 1100, margin: 'auto', padding: 35 }}>
    <Brand />
    <p className="muted-note">
      FICTIONAL MAC PREVIEW · Separate temporary storage · No real repository scans
    </p>
    <div style={{ marginTop: 30 }}>
      <TeamConnectionsPanel demo={false} repositories={createDemoSnapshot().repositories} />
    </div>
  </main>,
);
