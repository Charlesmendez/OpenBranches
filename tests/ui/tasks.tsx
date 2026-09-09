import { AgentBadges } from '../../src/ui/components/AgentBadges';
// Development-only fictional task action fixture. No system handler, network,
// repository, or real Codex task is opened by this page.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { DesktopApi, OpenTaskCommand, OpenTaskResult, TaskLink } from '../../src/domain/types';
import { TaskDetails } from '../../src/ui/components/TaskDetails';
import '../../src/ui/styles.css';

const results: OpenTaskResult[] = ['sent', 'not-linked', 'invalid-link', 'unavailable', 'failed'];
const tasks: TaskLink[] = Array.from({ length: 4 }, (_, i) => ({
  id: `fictional-${i}`,
  tool: 'codex',
  title: [
    'Improve project search',
    'Recover the unfinished navigation experiment across branch groups and worktrees',
    'Untitled Codex task',
    'Review keyboard navigation',
  ][i],
  status: 'unknown',
  association: i % 2 ? 'possible' : 'verified',
  archived: i === 1,
  updatedAt: '2026-09-08T12:00:00.000Z',
  checkedAt: '2026-09-09T12:00:00.000Z',
  evidence: ['Saved branch matches.', 'Saved commit matches the local branch tip.'],
}));

const mixed = new URLSearchParams(location.search).has('agents');
if (mixed) {
  tasks[1] = {
    ...tasks[1],
    id: tasks[0].id,
    tool: 'claude-code',
    model: { id: 'claude-sonnet-4-6' },
  };
  tasks[2] = { ...tasks[2], tool: 'unknown', title: 'Session without a recorded tool' };
  tasks[3] = { ...tasks[3], tool: 'cursor', model: { id: 'grok-code-fast-1', provider: 'xai' } };
}

function Fixture() {
  const [mode, setMode] = useState('desktop');
  const [result, setResult] = useState<OpenTaskResult>('sent');
  const [requests, setRequests] = useState<OpenTaskCommand[]>([]);
  const [pending, setPending] = useState<((result: OpenTaskResult) => void)[]>([]);
  window.openbranches =
    mode === 'preview'
      ? undefined
      : ({
          openCodexTask: (command: OpenTaskCommand) =>
            new Promise<OpenTaskResult>((resolve) => {
              setRequests((old) => [...old, command]);
              setPending((old) => [...old, resolve]);
            }),
        } as DesktopApi);
  return (
    <main
      style={{
        width: 'min(900px, 100%)',
        margin: '40px auto',
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: 40,
      }}
    >
      <div>
        <h1>Task action fixture</h1>
        <p>Fictional tasks. All desktop responses are controlled here.</p>
        <label>
          Environment{' '}
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="desktop">Desktop fixture</option>
            <option value="demo">Demo</option>
            <option value="preview">Browser preview</option>
          </select>
        </label>
        <label>
          Desktop response{' '}
          <select
            value={result}
            onChange={(event) => setResult(event.target.value as OpenTaskResult)}
          >
            {results.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={!pending.length}
          onClick={() => {
            pending.forEach((resolve) => resolve(result));
            setPending([]);
          }}
        >
          Deliver response
        </button>
        <p role="status">
          {requests.length} requests · {pending.length} pending
        </p>
        <pre aria-label="Requested task">{JSON.stringify(requests.at(-1) ?? null, null, 2)}</pre>
      </div>
      <div>
        {mixed && <AgentBadges branch={{ tasks }} />}
        <TaskDetails
          key={mode}
          tasks={tasks}
          demo={mode === 'demo'}
          repositoryId="fictional-atlas"
          branchId="fictional-search"
        />
      </div>
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
