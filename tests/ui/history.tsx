// Fictional source states for visual and keyboard verification. This entry is
// development-only and performs no desktop, repository, or GitHub operations.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Inspector } from '../../src/ui/components/Inspector';
import { createDemoSnapshot } from '../../src/data/demo';
import '../../src/ui/styles.css';

const scenarios = [
  'Different commits',
  'Waiting for GitHub',
  'Remote only',
  'Older PR checked',
  'GitHub unavailable',
  'New target',
] as const;
function Fixture() {
  const [scenario, setScenario] = useState<string>(scenarios[0]);
  const [message, setMessage] = useState('');
  const repository = createDemoSnapshot().repositories[0];
  repository.targets = [
    { name: 'develop', sha: '6'.repeat(40), source: 'local' },
    { name: 'master', sha: '7'.repeat(40), source: 'local' },
  ];
  const branch = repository.branches.find((branch) => branch.local && branch.remote)!;
  branch.name = 'codex/streaming-search';
  branch.title = 'Streaming search';
  branch.local = { ...branch.local!, name: branch.name, sha: 'a'.repeat(40) };
  branch.remote = {
    ...branch.remote!,
    name: branch.name,
    sha: 'b'.repeat(40),
    source: 'github',
    checkedAt: new Date().toISOString(),
  };
  branch.tasks = [];
  branch.pullRequest = undefined;
  branch.pullLookup =
    scenario === 'Older PR checked'
      ? {
          headSha: branch.local.sha,
          checkedAt: new Date().toISOString(),
          complete: true,
          found: false,
        }
      : undefined;
  branch.worktrees = [];
  branch.integration = { develop: 'pending', master: 'pending' };
  branch.publishedHistory = {
    repository: 'example/atlas-api',
    remoteName: 'origin',
    branchSha: branch.remote.sha,
    checkedAt: new Date().toISOString(),
    unavailable: scenario === 'GitHub unavailable',
    targets: [
      {
        name: 'develop',
        sha: 'c'.repeat(40),
        state: scenario === 'Waiting for GitHub' ? 'unknown' : 'integrated',
        source: 'github',
      },
      { name: 'master', sha: 'd'.repeat(40), state: 'pending', source: 'github' },
    ],
  };
  if (scenario === 'Remote only') branch.local = undefined;
  if (scenario === 'New target')
    branch.publishedHistory.targets.push({ name: 'main', sha: 'e'.repeat(40), state: 'unknown' });
  return (
    <div
      style={{ display: 'flex', height: '100vh', padding: 20, gap: 40, justifyContent: 'center' }}
    >
      <main style={{ width: 330, paddingTop: 80 }}>
        <p className="history-caption">FICTIONAL UI FIXTURE</p>
        <h1>Two copies. Clear evidence.</h1>
        <p style={{ color: '#a3b7c0', lineHeight: 1.8, margin: '24px 0' }}>
          The published branch has reached develop. The Mac has newer work that still needs
          integration. Each source keeps its own commit and target history.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {scenarios.map((name) => (
            <button
              className="secondary-button"
              key={name}
              aria-pressed={scenario === name}
              onClick={() => setScenario(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <p role="status">{message}</p>
      </main>
      <Inspector
        key={scenario}
        branch={branch}
        repository={repository}
        demo
        close={() => setMessage('Close requested')}
        onError={setMessage}
      />
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
