import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDemoSnapshot } from '../../src/data/demo';
import type { ActivityEvent } from '../../src/domain/types';
import { Activity } from '../../src/ui/components/Activity';
import { NavigationMemory } from '../../src/ui/navigationMemory';
import '../../src/ui/styles.css';
import './activity.css';

const now = Date.now();
const snapshot = createDemoSnapshot(now);
const kinds: ActivityEvent['kind'][] = ['commit', 'branch', 'worktree', 'integration'];
const labels = {
  commit: 'Branch tip changed',
  branch: 'Branch discovered',
  worktree: 'Worktree locations changed',
  integration: 'Integrated into develop',
};
const events = Array.from({ length: 85 }, (_, index): ActivityEvent => {
  const repository = snapshot.repositories[index % snapshot.repositories.length];
  const branch = repository.branches[index % repository.branches.length];
  const kind = kinds[index % kinds.length];
  return {
    id: `fixture-${index}`,
    repositoryId: repository.id,
    branchId: branch.id,
    kind,
    title: labels[kind],
    detail: branch.title,
    at: new Date(now - index * 2 * 60 * 60_000).toISOString(),
  };
});
const navigation = new NavigationMemory(() => ({
  getItem: (key) => localStorage.getItem(`activity-fixture-${key}`),
  setItem: (key, value) => localStorage.setItem(`activity-fixture-${key}`, value),
}));

function Fixture() {
  const [message, setMessage] = useState('Select any event to inspect its branch.');
  return (
    <main className="activity-fixture">
      <header>
        <span>ACTIVITY SCALE FIXTURE</span>
        <h1>The work keeps moving.</h1>
        <p>{message}</p>
      </header>
      <Activity
        events={events}
        repositories={snapshot.repositories}
        demo
        navigation={navigation}
        mode="demo"
        onSelect={(repositoryId, branchId) => setMessage(`Opened ${repositoryId} · ${branchId}`)}
      />
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
