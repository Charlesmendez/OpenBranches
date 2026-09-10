// Fictional UI regression surface. No desktop API or personal repository access.
import { createRoot } from 'react-dom/client';
import { StrictMode, useMemo, useState } from 'react';
import { createDemoSnapshot } from '../../src/data/demo';
import type { Repository } from '../../src/domain/types';
import { BranchMap } from '../../src/ui/components/BranchMap';
import { Inventory } from '../../src/ui/components/Inventory';
import { ProjectWorkSpotlight } from '../../src/ui/components/ProjectWorkSpotlight';
import { Overview } from '../../src/ui/components/Overview';
import { mapPositionFor, type MapPosition } from '../../src/ui/navigation';
import '../../src/ui/styles.css';
import '../../src/ui/components/workflow.css';
import './targets.css';

type Scenario = 'standard' | 'default' | 'missing';
type View = 'overview' | 'map' | 'inventory';
const busyFixture = new URLSearchParams(location.search).has('busy');

function repositoryFor(scenario: Scenario): Repository {
  const repository = structuredClone(createDemoSnapshot().repositories[0]);
  repository.name =
    scenario === 'standard'
      ? 'Fictional standard targets'
      : scenario === 'default'
        ? 'Fictional trunk project'
        : 'Fictional unknown target';
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
  if (scenario === 'standard') {
    const [develop, stable] = repository.targets;
    repository.targets = [
      develop,
      { ...develop, name: 'dev' },
      { ...stable, name: 'main' },
      stable,
    ];
    repository.branches = repository.branches.map((branch) => ({
      ...branch,
      integration: {
        develop: branch.integration.develop ?? 'unknown',
        dev: branch.integration.develop ?? 'unknown',
        main: branch.integration.master ?? 'unknown',
        master: branch.integration.master ?? 'unknown',
      },
      remoteIntegration: branch.remoteIntegration
        ? {
            develop: branch.remoteIntegration.develop ?? 'unknown',
            dev: branch.remoteIntegration.develop ?? 'unknown',
            main: branch.remoteIntegration.master ?? 'unknown',
            master: branch.remoteIntegration.master ?? 'unknown',
          }
        : undefined,
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

function clonedRepository(repository: Repository, id: string, name: string): Repository {
  return {
    ...structuredClone(repository),
    id,
    name,
    path: `/demo/${name}`,
    commonDir: `/demo/${name}/.git`,
    branches: repository.branches.map((branch, index) => ({
      ...structuredClone(branch),
      id: `${id}:${index}`,
      repositoryId: id,
    })),
  };
}

function Fixture() {
  const [scenario, setScenario] = useState<Scenario>('standard');
  const [view, setView] = useState<View>('map');
  const repository = useMemo(() => {
    const value = repositoryFor(scenario);
    if (!busyFixture) return value;
    const checkedAt = new Date().toISOString();
    value.branches = value.branches.map((branch, index) =>
      index < 7
        ? {
            ...branch,
            tasks: [
              {
                id: `busy-task-${index}`,
                tool: (['codex', 'claude-code', 'cursor'] as const)[index % 3],
                title: `Work on ${branch.title}`,
                status: index === 2 ? 'idle' : 'active',
                waiting: index === 2,
                association: 'verified',
                checkedAt,
              },
            ],
          }
        : branch,
    );
    return value;
  }, [scenario]);
  const snapshot = useMemo(() => {
    const value = createDemoSnapshot();
    return {
      ...value,
      repositories: [
        ...value.repositories,
        clonedRepository(value.repositories[1], 'forge', 'forge-web'),
        clonedRepository(value.repositories[2], 'harbor', 'harbor-worker'),
        clonedRepository(value.repositories[1], 'lumen', 'lumen-mobile'),
        clonedRepository(value.repositories[2], 'orbit', 'orbit-jobs'),
      ],
    };
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapRequest, setMapRequest] = useState(0);
  const [mapPosition, setMapPosition] = useState<MapPosition>({ expanded: 'tracked', page: 0 });
  const focusMapBranch = (branch: Repository['branches'][number]) => {
    setSelected(branch.id);
    setMapPosition(mapPositionFor(repository.branches, branch.id, repository.path)!);
    setMapRequest((value) => value + 1);
  };
  return (
    <main className="target-fixture">
      <header>
        <div>
          <strong>Integration target states</strong>
          <span>Fictional data</span>
        </div>
        <div className="fixture-controls">
          <div className="history-sources" role="group" aria-label="View">
            <button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>
              Projects
            </button>
            <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
              Map
            </button>
            <button aria-pressed={view === 'inventory'} onClick={() => setView('inventory')}>
              Inventory
            </button>
          </div>
          <div className="history-sources" role="group" aria-label="Target scenario">
            <button aria-pressed={scenario === 'standard'} onClick={() => setScenario('standard')}>
              Standard
            </button>
            <button aria-pressed={scenario === 'default'} onClick={() => setScenario('default')}>
              Remote default
            </button>
            <button aria-pressed={scenario === 'missing'} onClick={() => setScenario('missing')}>
              No target
            </button>
          </div>
        </div>
      </header>
      {view === 'overview' ? (
        <Overview
          repositories={snapshot.repositories}
          events={snapshot.events}
          onProject={() => {}}
          onActivity={() => {}}
          onSelect={() => {}}
          onFocus={() => setView('map')}
          onAdd={() => {}}
        />
      ) : view === 'map' ? (
        <div className="target-map-view">
          <ProjectWorkSpotlight
            repository={repository}
            branches={repository.branches}
            onFocus={focusMapBranch}
          />
          <BranchMap
            key={`map:${scenario}:${mapRequest}`}
            repository={repository}
            branches={repository.branches}
            selectedId={selected}
            onSelect={(branch) => setSelected(branch.id)}
            onInventory={() => {}}
            initialPosition={mapPosition}
            remember={() => {}}
            onScopeChange={() => setSelected(null)}
          />
        </div>
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
