import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, GitBranch, Search, X } from 'lucide-react';
import { branchSearchResults } from '../../domain/branchSearch';
import type { Branch, Repository } from '../../domain/types';
import { BranchTargetSummary } from './BranchTargetSummary';
import { WorkSignalIcon } from './WorkSignalIcon';

export function SearchDialog({
  repositories,
  close,
  focus,
}: {
  repositories: Repository[];
  close: () => void;
  focus: (repository: Repository, branch: Branch) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const choosing = useRef(false);
  const matches = useMemo(
    () => branchSearchResults(repositories, query, now),
    [repositories, query, now],
  );
  const results = matches.slice(0, 50);
  const activeCount = matches.filter(({ activity }) => activity).length;
  const choose = (repository: Repository, branch: Branch) => {
    choosing.current = true;
    close();
    // Let the initiating key finish after the dialog unmounts, then route and
    // focus the branch card without reactivating the search trigger.
    requestAnimationFrame(() => focus(repository, branch));
  };
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    input.current?.focus();
    return () => {
      // A selected result may already have focused its map. Restore
      // the search origin only when closing would otherwise leave focus behind.
      if (
        !choosing.current &&
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body || element?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setIndex(0);
  }, [query]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
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
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          }
          if (event.key === 'Enter' && results[index]) {
            choose(results[index].repository, results[index].branch);
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
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="branch-search-results"
            aria-activedescendant={results[index] ? `branch-search-result-${index}` : undefined}
          />
          <button onClick={close} aria-label="Close search">
            <X size={16} />
          </button>
        </div>
        <div className="search-label" role="status" aria-live="polite">
          {query
            ? `${matches.length} matches across all projects${activeCount ? ` · ${activeCount} working now` : ''}`
            : activeCount
              ? `${activeCount} working now · then recent branches`
              : 'RECENT BRANCHES'}
        </div>
        <div
          className="search-results"
          id="branch-search-results"
          role="listbox"
          aria-label="Branch results"
        >
          {results.map(({ branch, repository, activity }, i) => (
            <button
              id={`branch-search-result-${i}`}
              key={`${repository.id}:${branch.id}`}
              data-result-index={i}
              className={`${index === i ? 'highlighted' : ''}${activity ? ` ${activity.kind}` : ''}`}
              aria-label={`${branch.title} in ${repository.name}${activity ? `. ${activity.label}` : ''}. Open on map.`}
              role="option"
              aria-selected={index === i}
              onClick={() => choose(repository, branch)}
            >
              <span className={`search-result-icon${activity ? ` ${activity.kind}` : ''}`}>
                {activity ? <WorkSignalIcon signal={activity} /> : <GitBranch size={16} />}
              </span>
              <div className="search-result-copy">
                <span className="search-result-title">
                  <strong>{branch.title}</strong>
                  {activity && <b className={activity.kind}>{activity.label}</b>}
                </span>
                <code>
                  {repository.name} / {branch.name}
                </code>
                <span className="search-result-targets">
                  <small>LOCAL GIT</small>
                  <BranchTargetSummary branch={branch} targets={repository.targets} />
                </span>
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
            <kbd>↓</kbd> to navigate <kbd>↵</kbd> to open on map
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
