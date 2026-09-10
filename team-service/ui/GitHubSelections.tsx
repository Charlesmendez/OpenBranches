import { useState } from 'react';
import { GitFork } from 'lucide-react';
import type { GitHubSetupState } from '../../src/team/github';
import { dateLabel, Empty, ListSearch, Notice } from './primitives';
type Selection = GitHubSetupState['selections'][number];
export function GitHubSelections({
  selections,
  onRemove,
}: {
  selections: Selection[];
  onRemove: (value: Selection) => void;
}) {
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(12);
  if (!selections.length) return null;
  const filtered = selections.filter((p) => p.fullName.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="github-selected">
      <header>
        <h3>Selected GitHub projects</h3>
        <span>{selections.length}</span>
      </header>
      <Notice>
        OpenBranches refreshes branch and pull-request metadata in the background. A failed refresh
        keeps the last verified snapshot and retries automatically.
      </Notice>
      <ListSearch
        label="Search selected GitHub projects"
        placeholder="Find a selected project…"
        value={query}
        onChange={(value) => {
          setQuery(value);
          setLimit(12);
        }}
      />
      {filtered.slice(0, limit).map((p) => (
        <div className="github-selected-project" key={p.projectId}>
          <GitFork size={17} />
          <span>
            <strong>{p.fullName}</strong>
            <small>{selectionStatus(p)}</small>
          </span>
          <button className="text-button" onClick={() => onRemove(p)}>
            Remove selection
          </button>
        </div>
      ))}
      {!filtered.length && <Empty title="No matching selections">Try another project name.</Empty>}
      {filtered.length > limit && (
        <button className="more-branches" onClick={() => setLimit((v) => v + 24)}>
          Show more selected projects
        </button>
      )}
    </section>
  );
}

function selectionStatus(selection: Selection) {
  const counts = `${selection.branchCount.toLocaleString()} branches · ${selection.openPullCount.toLocaleString()} open ${selection.openPullCount === 1 ? 'PR' : 'PRs'}`;
  if (selection.syncState === 'waiting') return 'Waiting for first refresh';
  if (selection.syncState === 'error')
    return selection.snapshotAt
      ? `Refresh failed · ${counts} · Last verified ${dateLabel(selection.snapshotAt)}`
      : `First refresh failed · Retrying automatically`;
  return `${selection.syncState === 'partial' ? 'Partial snapshot' : 'Current'} · ${counts} · ${dateLabel(selection.snapshotAt)}`;
}
