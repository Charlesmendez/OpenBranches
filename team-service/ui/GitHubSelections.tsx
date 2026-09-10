import { useState } from 'react';
import { GitFork } from 'lucide-react';
import type { GitHubSetupState } from '../../src/team/github';
import { Empty, ListSearch, Notice } from './primitives';
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
        Selections are saved. Branch and PR synchronization is still being connected in this
        preview.
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
            <small>Selected · {new Date(p.selectedAt).toLocaleDateString()}</small>
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
