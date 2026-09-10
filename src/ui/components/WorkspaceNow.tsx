import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Radio,
  Search,
  X,
} from 'lucide-react';
import { relativeTime } from '../../domain/branches';
import { pullAttentionCues } from '../../domain/collaboration';
import type { Branch, GitHubPullRequest, Repository } from '../../domain/types';
import {
  filterWorkspaceNow,
  workspaceNow,
  type WorkspaceNowFilter,
  type WorkspaceNowPull,
  type WorkspaceNowRow,
} from '../../domain/workspaceNow';
import { usePageWindow } from '../hooks/usePageWindow';
import { BranchTargetSummary } from './BranchTargetSummary';
import { CompactPager } from './CompactPager';
import { WorkSignalIcon, workSignalStateLabel } from './WorkSignalIcon';
import './workspaceNow.css';

const PROJECT_PAGE_SIZE = 5;
const COLLAPSED_ROWS = 4;
const EXPANDED_ROWS = 12;

const countLabel = (count: number, singular: string, plural = singular + 's') =>
  `${count} ${count === 1 ? singular : plural}`;

function PullNode({
  item,
  now,
  onOpen,
}: {
  item: WorkspaceNowPull;
  now: number;
  onOpen: (item: WorkspaceNowPull) => void;
}) {
  const pull = item.pull;
  const cue = pullAttentionCues(pull as GitHubPullRequest, now)[0];
  return (
    <button
      className={`workspace-now-pull ${pull.draft ? 'draft' : ''} ${item.stale ? 'stale' : ''}`}
      aria-label={`Open pull request ${pull.number}: ${pull.title}`}
      onClick={() => onOpen(item)}
    >
      <span className="workspace-now-node-state">
        <GitPullRequest size={13} />
        {pull.draft ? 'DRAFT PR' : 'OPEN PR'}
        {item.stale && <i>SAVED</i>}
      </span>
      <strong>{pull.title}</strong>
      <span className="workspace-now-pr-route">
        <code>#{pull.number}</code>
        <span>{item.headName}</span>
        <span aria-hidden="true">→</span>
        <code>{pull.base}</code>
      </span>
      <span className="workspace-now-pr-foot">
        <span>{pull.author ? `@${pull.author.login}` : (item.repositorySlug ?? 'GitHub')}</span>
        {cue ? (
          <span className={`workspace-now-cue ${cue.kind}`}>
            {cue.kind === 'failed-checks' ? (
              <CircleAlert size={11} />
            ) : cue.kind === 'quiet-draft' ? (
              <Clock3 size={11} />
            ) : (
              <Eye size={11} />
            )}
            {cue.label}
          </span>
        ) : (
          <span>Updated {relativeTime(pull.updatedAt, now).toLowerCase()}</span>
        )}
        <ArrowUpRight size={12} aria-hidden="true" />
      </span>
    </button>
  );
}

function BranchNode({
  row,
  onFocus,
}: {
  row: WorkspaceNowRow;
  onFocus: (repository: Repository, branch: Branch) => void;
}) {
  if (row.branch) {
    const { repository, branch, signal } = row.branch;
    return (
      <button
        className={`workspace-now-branch ${signal.kind}`}
        title={signal.detail}
        aria-label={`${signal.label}: ${branch.title} in ${repository.name}. Show on map.`}
        onClick={() => onFocus(repository, branch)}
      >
        <span className="workspace-now-agent-icon">
          <WorkSignalIcon signal={signal} />
        </span>
        <span className="workspace-now-branch-copy">
          <span className="workspace-now-node-state">
            <i aria-hidden="true" />
            {workSignalStateLabel(signal.kind)}
          </span>
          <strong>{branch.title}</strong>
          <code>{branch.name}</code>
          <small>{signal.label}</small>
          <BranchTargetSummary branch={branch} targets={repository.targets} />
        </span>
        <ArrowUpRight size={13} aria-hidden="true" />
      </button>
    );
  }

  const pull = row.pull!;
  const link = pull.links[0];
  const content = (
    <>
      <span className="workspace-now-published-icon">
        <GitBranch size={15} />
      </span>
      <span className="workspace-now-branch-copy">
        <span className="workspace-now-node-state">PUBLISHED BRANCH</span>
        <strong>{pull.headName}</strong>
        <small>{link ? `Found in ${link.repository.name}` : 'Observed on GitHub'}</small>
      </span>
      {link && <ArrowUpRight size={13} aria-hidden="true" />}
    </>
  );
  return link ? (
    <button
      className="workspace-now-branch published"
      aria-label={`Show ${pull.headName} in ${link.repository.name}`}
      onClick={() => onFocus(link.repository, link.branch)}
    >
      {content}
    </button>
  ) : (
    <div
      className="workspace-now-branch published"
      aria-label={`Published branch ${pull.headName}`}
    >
      {content}
    </div>
  );
}

export function WorkspaceNow({
  repositories,
  now,
  demo,
  onProject,
  onFocus,
  onPulls,
  onSources,
}: {
  repositories: Repository[];
  now: number;
  demo: boolean;
  onProject: (id: string) => void;
  onFocus: (repository: Repository, branch: Branch) => void;
  onPulls: () => void;
  onSources: () => void;
}) {
  const [filter, setFilter] = useState<WorkspaceNowFilter>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState('');
  const model = useMemo(() => workspaceNow(repositories, now), [repositories, now]);
  const projects = useMemo(() => filterWorkspaceNow(model, filter, query), [model, filter, query]);
  const pageKey = `${filter}:${query}:${projects.map((project) => `${project.id}:${project.rows.length}`).join('|')}`;
  const page = usePageWindow(projects, PROJECT_PAGE_SIZE, pageKey);
  const currentCount = model.projects.reduce((sum, project) => sum + project.rows.length, 0);
  const filters: { id: WorkspaceNowFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Everything now', count: currentCount },
    { id: 'live', label: 'Active branches', count: model.live + model.waiting },
    { id: 'pulls', label: 'Open PRs', count: model.pulls },
  ];

  const openPull = async (item: WorkspaceNowPull) => {
    if (demo) {
      setMessage('This pull request is part of the fictional demo.');
      return;
    }
    if (!window.openbranches) {
      setMessage('Open this PR from the OpenBranches desktop app.');
      return;
    }
    try {
      await window.openbranches.openExternal(item.pull.url);
      setMessage('');
    } catch {
      setMessage('Could not open GitHub. Please try again.');
    }
  };

  return (
    <section className="workspace-now" aria-labelledby="workspace-now-title">
      <header className="workspace-now-header">
        <div className="workspace-now-intro">
          <span className="workspace-now-kicker">
            <Radio size={13} /> WORKSPACE NOW
          </span>
          <h2 id="workspace-now-title">What&apos;s happening right now</h2>
          <p>Verified agent sessions and recently confirmed open pull requests.</p>
        </div>
        <div className="workspace-now-summary" aria-label="Current work summary">
          <span className={model.live ? 'is-live' : ''}>
            <strong>{model.live}</strong>
            working now
          </span>
          <span className={model.waiting ? 'is-waiting' : ''}>
            <strong>{model.waiting}</strong>
            waiting
          </span>
          <span>
            <strong>{model.pulls}</strong>
            open PRs
          </span>
          <span>
            <strong>{model.projects.length}</strong>
            active projects
          </span>
        </div>
      </header>

      <div className="workspace-now-toolbar">
        <div className="workspace-now-filters" role="group" aria-label="Current work type">
          {filters.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <b>{item.count}</b>
            </button>
          ))}
        </div>
        <label className="workspace-now-search">
          <Search size={13} aria-hidden="true" />
          <span className="sr-only">Filter current work</span>
          <input
            value={query}
            placeholder="Filter current work…"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="Clear current work filter" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      {model.unverifiedPulls > 0 && (
        <div className="workspace-now-freshness" role="status">
          <span className="workspace-now-freshness-icon">
            <CircleAlert size={15} />
          </span>
          <span>
            <strong>{countLabel(model.unverifiedPulls, 'saved PR record')} hidden</strong>
            <small>
              GitHub has not confirmed that {model.unverifiedPulls === 1 ? 'it is' : 'they are'}
              still open, so {model.unverifiedPulls === 1 ? 'it is' : 'they are'} excluded from this
              live view.
            </small>
          </span>
          <button className="text-button" onClick={onSources}>
            Fix GitHub updates <ArrowUpRight size={12} />
          </button>
        </div>
      )}

      {projects.length ? (
        <>
          <div className="workspace-now-column-labels" aria-hidden="true">
            <span>PROJECT</span>
            <span>ACTIVE OR PUBLISHED BRANCH</span>
            <span>OPEN PULL REQUEST</span>
          </div>
          <div className="workspace-now-projects">
            {page.items.map((project) => {
              const isExpanded = expanded.has(project.id);
              const rowLimit = isExpanded ? EXPANDED_ROWS : COLLAPSED_ROWS;
              const rows = project.rows.slice(0, rowLimit);
              const hidden = project.rows.length - rows.length;
              const primaryRepository = project.repositories[0];
              const visiblePulls = new Set<string>();
              return (
                <article className="workspace-now-project" key={project.id}>
                  <div className="workspace-now-project-anchor">
                    <button
                      disabled={!primaryRepository}
                      title={`${project.detail ?? project.name}: ${[
                        project.live ? `${project.live} live` : '',
                        project.waiting ? `${project.waiting} waiting` : '',
                        project.pulls ? countLabel(project.pulls, 'open PR') : '',
                      ]
                        .filter(Boolean)
                        .join(', ')}`}
                      onClick={() => primaryRepository && onProject(primaryRepository.id)}
                    >
                      <span className="workspace-now-project-icon">
                        <FolderGit2 size={17} />
                      </span>
                      <span>
                        <strong>{project.name}</strong>
                        {project.detail && <code>{project.detail}</code>}
                        <small>
                          {[
                            project.live ? `${project.live} live` : '',
                            project.waiting ? `${project.waiting} waiting` : '',
                            project.pulls ? countLabel(project.pulls, 'open PR') : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="workspace-now-project-rows">
                    {rows.map((row) => {
                      const repeatedPull = !!row.pull && visiblePulls.has(row.pull.id);
                      if (row.pull) visiblePulls.add(row.pull.id);
                      return (
                        <div
                          className={`workspace-now-row ${row.branch?.signal.kind ?? 'published'}`}
                          key={row.id}
                        >
                          <BranchNode row={row} onFocus={onFocus} />
                          <span className={`workspace-now-edge ${row.pull ? 'connected' : ''}`}>
                            <i />
                          </span>
                          {row.pull ? (
                            repeatedPull ? (
                              <button
                                className="workspace-now-shared-pr"
                                onClick={() => void openPull(row.pull!)}
                              >
                                <GitPullRequest size={13} />
                                <span>
                                  Also linked to PR #{row.pull.pull.number}
                                  <small>Shown above · open on GitHub</small>
                                </span>
                                <ArrowUpRight size={12} />
                              </button>
                            ) : (
                              <PullNode item={row.pull} now={now} onOpen={openPull} />
                            )
                          ) : (
                            <div className="workspace-now-no-pr">
                              <span>No open PR</span>
                              <small>Work is still local or unpublished</small>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!isExpanded && hidden > 0 && (
                      <button
                        className="workspace-now-more"
                        onClick={() =>
                          setExpanded((value) => {
                            const next = new Set(value);
                            next.add(project.id);
                            return next;
                          })
                        }
                      >
                        <ChevronDown size={13} />
                        Show {Math.min(hidden, EXPANDED_ROWS - COLLAPSED_ROWS)} more
                      </button>
                    )}
                    {isExpanded && hidden > 0 && (
                      <div className="workspace-now-more-limit">
                        {countLabel(hidden, 'current item')} {hidden === 1 ? 'remains' : 'remain'}
                        hidden. Narrow the filter to find {hidden === 1 ? 'it' : 'them'}.
                      </div>
                    )}
                    {isExpanded && project.rows.length > COLLAPSED_ROWS && (
                      <button
                        className="workspace-now-more collapse"
                        onClick={() =>
                          setExpanded((value) => {
                            const next = new Set(value);
                            next.delete(project.id);
                            return next;
                          })
                        }
                      >
                        <ChevronDown size={13} /> Collapse project
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="workspace-now-footer">
            <span aria-live="polite">
              {countLabel(projects.length, 'project')} with current work
              {query && ` matching “${query}”`}
            </span>
            <div>
              {filter !== 'live' && (
                <button className="text-button" onClick={onPulls}>
                  Open PR workspace <ArrowUpRight size={12} />
                </button>
              )}
              {page.pageCount > 1 && (
                <CompactPager
                  page={page.page}
                  pageSize={PROJECT_PAGE_SIZE}
                  count={projects.length}
                  label="Current project pages"
                  onPage={page.setPage}
                />
              )}
            </div>
          </footer>
        </>
      ) : (
        <div className="workspace-now-empty">
          <span>
            <Radio size={18} />
          </span>
          <div>
            <strong>
              {currentCount ? 'No current work matches this view.' : 'Nothing is active right now.'}
            </strong>
            <small>
              {currentCount
                ? 'Clear the filter to return to the full control panel.'
                : 'No verified agent sessions or open pull requests were found across your projects.'}
            </small>
          </div>
          {currentCount ? (
            <button
              className="text-button"
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
            >
              Clear filter
            </button>
          ) : (
            <button className="text-button" onClick={onPulls}>
              Check PR connections <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="workspace-now-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
