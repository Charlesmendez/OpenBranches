import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, GitBranch, Search, X } from 'lucide-react';
import type { Repository } from '../../domain/types';

export function SearchDialog({
  repositories,
  close,
  select,
}: {
  repositories: Repository[];
  close: () => void;
  select: (repositoryId: string, branchId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const matches = useMemo(
    () =>
      repositories
        .flatMap((repo) => repo.branches.map((branch) => ({ repo, branch })))
        .filter(({ branch, repo }) =>
          `${branch.name} ${branch.title} ${branch.tasks?.map((task) => task.title).join(' ') ?? ''} ${repo.name}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) => b.branch.updatedAt.localeCompare(a.branch.updatedAt)),
    [repositories, query],
  );
  const results = matches.slice(0, 50);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setIndex(0);
  }, [query]);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-result-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search all branches"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          }
          if (event.key === 'Enter' && results[index]) {
            select(results[index].repo.id, results[index].branch.id);
            close();
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <div className="search-dialog-input">
          <Search size={20} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find any branch, task, or project…"
            aria-label="Search all projects"
          />
          <button onClick={close} aria-label="Close search">
            <X size={16} />
          </button>
        </div>
        <div className="search-label">
          {query ? `${matches.length} matches across all groups` : 'RECENT BRANCHES'}
        </div>
        <div className="search-results">
          {results.map(({ branch, repo }, i) => (
            <button
              key={branch.id}
              data-result-index={i}
              className={index === i ? 'highlighted' : ''}
              onClick={() => {
                select(repo.id, branch.id);
                close();
              }}
            >
              <span className="search-result-icon">
                <GitBranch size={16} />
              </span>
              <div>
                <strong>{branch.title}</strong>
                <code>
                  {repo.name} / {branch.name}
                </code>
              </div>
              <ArrowUpLeft size={14} />
            </button>
          ))}
          {!results.length && (
            <p className="search-no-results">No matching branches. Try a shorter name.</p>
          )}
        </div>
        <div className="search-dialog-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate <kbd>↵</kbd> to inspect
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
