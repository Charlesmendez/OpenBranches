// Fictional UI regression surface. No desktop API or personal repository access.
import { createRoot } from 'react-dom/client';
import { StrictMode, useMemo, useState } from 'react';
import { createDemoSnapshot } from '../../src/data/demo';
import type { Repository } from '../../src/domain/types';
import { BranchMap } from '../../src/ui/components/BranchMap';
import { Inventory } from '../../src/ui/components/Inventory';
import '../../src/ui/styles.css';
import '../../src/ui/components/workflow.css';
import './targets.css';

type Scenario = 'default' | 'missing';
type View = 'map' | 'inventory';

function repositoryFor(scenario: Scenario): Repository {
  const repository = structuredClone(createDemoSnapshot().repositories[0]);
  repository.name = scenario === 'default' ? 'Fictional trunk project' : 'Fictional unknown target';
  if (scenario === 'missing') {
    repository.targets = [];
    repository.branches = repository.branches.map((branch) => ({
      ...branch,
      integration: {},
      remoteIntegration: branch.remoteIntegration ? {} : undefined,
      publishedHistory: undefined,
    }));
    repository.github = undefined;
    return repository;
  }
  const previous = repository.targets[0];
  repository.targets = [
    {
      name: 'trunk',
      sha: previous.sha,
      source: 'local',
      remote: 'origin',
      role: 'default',
    },
  ];
  repository.branches = repository.branches.map((branch) => ({
    ...branch,
    integration: {
      trunk: Object.values(branch.integration).includes('integrated') ? 'integrated' : 'pending',
    },
    remoteIntegration: branch.remoteIntegration
      ? {
          trunk: Object.values(branch.remoteIntegration).includes('integrated')
            ? 'integrated'
            : 'pending',
        }
      : undefined,
    publishedHistory: undefined,
  }));
  repository.github = undefined;
  return repository;
}

function Fixture() {
  const [scenario, setScenario] = useState<Scenario>('default');
  const [view, setView] = useState<View>('map');
  const repository = useMemo(() => repositoryFor(scenario), [scenario]);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <main className="target-fixture">
      <header>
        <div>
          <strong>Integration target states</strong>
          <span>Fictional data</span>
        </div>
        <div className="fixture-controls">
          <div className="history-sources" role="group" aria-label="View">
            <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
              Map
            </button>
            <button aria-pressed={view === 'inventory'} onClick={() => setView('inventory')}>
              Inventory
            </button>
          </div>
          <div className="history-sources" role="group" aria-label="Target scenario">
            <button aria-pressed={scenario === 'default'} onClick={() => setScenario('default')}>
              Remote default
            </button>
            <button aria-pressed={scenario === 'missing'} onClick={() => setScenario('missing')}>
              No target
            </button>
          </div>
        </div>
      </header>
      {view === 'map' ? (
        <BranchMap
          key={`map:${scenario}`}
          repository={repository}
          branches={repository.branches}
          selectedId={selected}
          onSelect={(branch) => setSelected(branch.id)}
          onInventory={() => {}}
          initialPosition={{ expanded: 'tracked', page: 0 }}
          remember={() => {}}
          onScopeChange={() => setSelected(null)}
        />
      ) : (
        <Inventory
          key={`inventory:${scenario}`}
          repository={repository}
          branches={repository.branches}
          selectedId={selected}
          onSelect={(branch) => setSelected(branch.id)}
          remember={() => {}}
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
