// Development-only fictional review queues. This fixture uses demo data and
// never reads repositories or opens an agent.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { createDemoSnapshot } from '../../src/data/demo';
import { Attention } from '../../src/ui/components/Attention';
import { useReviews } from '../../src/ui/hooks/useReviews';
import '../../src/ui/styles.css';
import '../../src/ui/components/workflow.css';

localStorage.removeItem('ob-demo-reviews-v1');
const repositories = createDemoSnapshot().repositories;

function Fixture() {
  const reviews = useReviews(true, repositories);
  const [destination, setDestination] = useState('none');
  return (
    <main style={{ width: 'min(1120px, 100%)', margin: '0 auto', padding: 32 }}>
      <h1 style={{ marginBottom: 8 }}>Attention queue fixture</h1>
      <output style={{ display: 'block', marginBottom: 20 }}>Opened: {destination}</output>
      <Attention
        reviews={reviews}
        repositories={repositories}
        repositoryId={null}
        onSelect={(repositoryId, branchId) => setDestination(`${repositoryId}:${branchId}`)}
        onSettings={() => setDestination('settings')}
        demo
        codex={{ installed: true, enabled: true, state: 'ready', taskCount: 24 }}
      />
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
