import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  GitBranch,
  GitPullRequest,
  Layers,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import type { GitHubWorkSource } from '../../src/team/github';
import type { TeamPage } from '../../src/team/responses';
import { useGitHubWorkData } from './hooks';
import { dateLabel, Empty, Notice } from './primitives';
import './publishedWork.css';
import { AttentionCenter } from './AttentionCenter';

export function PublishedWork({
  client,
  workspace,
  people,
  projects,
  refreshKey,
}: {
  client: TeamClient;
  workspace: string;
  people: TeamPage['people'];
  projects: TeamPage['projects'];
  refreshKey: string;
}) {
  const [person, setPerson] = useState(''),
    [project, setProject] = useState(''),
    [query, setQuery] = useState('');
  const filter = { person: person || undefined, project: project || undefined, query },
    state = useGitHubWorkData(client, workspace, filter, refreshKey),
    sources = state.data?.sources ?? [];
  const metrics = useMemo(() => {
    const pulls = sources.flatMap((source) => source.pulls),
      open = pulls.filter((pull) => pull.state === 'open'),
      branches = sources.flatMap((source) => source.branches);
    return {
      open: open.length,
      failing: open.filter((pull) => pull.checks.state === 'failed').length,
      reviews: open.filter((pull) => pull.requestedReviewers.length || pull.requestedTeams.length)
        .length,
      outside: branches.filter((branch) =>
        branch.targets.some((target) => target.state === 'pending'),
      ).length,
    };
  }, [sources]);
  const focused = !!(person || project || query);
  return (
    <section className="published-work">
      <AttentionCenter
        client={client}
        workspace={workspace}
        projects={projects}
        refreshKey={refreshKey}
      />
      <div className="published-hero">
        <span className="published-symbol">
          <GitPullRequest size={25} />
        </span>
        <div>
          <span className="eyebrow">PUBLISHED WORK</span>
          <h2>Branches and pull requests, in one queue.</h2>
          <p>
            GitHub evidence shows published state and review involvement. Current activity comes
            from opted-in Mac reports.
          </p>
        </div>
        <span className="published-trust">
          <ShieldCheck size={14} /> Read-only
        </span>
      </div>

      <div className="published-metrics" aria-label="Loaded GitHub work summary">
        <Metric label="Open PRs" value={metrics.open} icon={GitPullRequest} />
        <Metric label="Checks failing" value={metrics.failing} icon={AlertTriangle} tone="danger" />
        <Metric label="Review requested" value={metrics.reviews} icon={UserRound} tone="review" />
        <Metric label="Outside targets" value={metrics.outside} icon={GitBranch} tone="warning" />
      </div>

      <div className="published-filters">
        <label className="team-search">
          <Search size={17} />
          <input
            aria-label="Search GitHub branches and pull requests"
            placeholder="Search branches, PRs, people, targets…"
            value={query}
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="icon" aria-label="Clear GitHub search" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter GitHub work by person"
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="">All people</option>
          {people.map((value) => (
            <option key={value.id} value={value.id}>
              @{value.login}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter GitHub work by project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="">All projects</option>
          {projects
            .filter((value) => value.githubId)
            .map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
        </select>
      </div>
      {person && (
        <p className="published-filter-note">
          Person matching means PR author, requested reviewer, or submitted reviewer. It does not
          assign ownership of every branch commit.
        </p>
      )}
      {state.error && <Notice error>{state.error}</Notice>}
      {!state.data && !state.error && (
        <div className="team-loading" role="status">
          <span className="loading-line" />
          <span className="loading-line" />
          <p>Loading GitHub branches and pull requests…</p>
        </div>
      )}
      {state.data && !sources.length && (
        <Empty title={focused ? 'No published work matches this view' : 'No GitHub snapshots yet'}>
          {focused
            ? 'Try another person, project, or search.'
            : 'A workspace owner can select repositories under GitHub projects. The first read will appear here automatically.'}
        </Empty>
      )}
      {state.data && sources.length > 0 && (
        <>
          <div className="published-caption">
            <span>
              {state.busy ? 'Updating GitHub evidence…' : `${sources.length} repositories loaded`}
            </span>
            <small>Snapshot checked {dateLabel(state.data.checkedAt)}</small>
          </div>
          <div className="published-sources">
            {sources.map((source, index) => (
              <PublishedSource
                key={source.projectId + String(focused)}
                source={source}
                focused={focused}
                initiallyOpen={focused || index === 0}
              />
            ))}
          </div>
          {state.data.nextCursor && (
            <div className="load-reports">
              {state.atLimit ? (
                <Notice>Narrow the project or search to load more GitHub evidence.</Notice>
              ) : (
                <button className="secondary" disabled={state.busy} onClick={state.loadMore}>
                  Load more repositories <ChevronDown size={15} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = '',
}: {
  label: string;
  value: number;
  icon: typeof GitBranch;
  tone?: string;
}) {
  return (
    <div className={`published-metric ${tone}`}>
      <span>
        <Icon size={15} /> {label}
      </span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function PublishedSource({
  source,
  focused,
  initiallyOpen,
}: {
  source: GitHubWorkSource;
  focused: boolean;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen),
    [mode, setMode] = useState<'pulls' | 'branches'>(source.openPullCount ? 'pulls' : 'branches'),
    [limit, setLimit] = useState(8);
  const items = mode === 'pulls' ? source.pulls : source.branches,
    summary = focused
      ? `${matchCount(source.branches.length, source.omittedBranches, 'branch', 'branches')} · ${matchCount(source.pulls.length, source.omittedPulls, 'PR')}`
      : `${count(source.branchCount, 'branch', 'branches')} · ${count(source.openPullCount, 'open PR')}`;
  return (
    <article className={`published-source ${source.syncState}`}>
      <header className="published-source-header">
        <button
          className="published-source-title"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="published-repo-icon">
            <Layers size={18} />
          </span>
          <span>
            <strong>{source.fullName}</strong>
            <small>
              {summary} · snapshot {dateLabel(source.snapshotAt)}
            </small>
          </span>
          <span className={`source-state ${source.syncState}`}>
            <i />
            {source.syncState === 'current'
              ? 'Current snapshot'
              : source.syncState === 'partial'
                ? 'Partial coverage'
                : 'Refresh failed'}
          </span>
          {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
      </header>
      {open && (
        <div className="published-source-body">
          {source.syncState !== 'current' && (
            <Notice>
              {source.syncState === 'error'
                ? 'The latest refresh failed. These are the last saved GitHub results.'
                : 'GitHub returned bounded results. Counts may exceed the rows available here.'}
            </Notice>
          )}
          <div className="published-mode" aria-label={`Choose ${source.fullName} evidence`}>
            <button
              aria-pressed={mode === 'pulls'}
              onClick={() => {
                setMode('pulls');
                setLimit(8);
              }}
            >
              <GitPullRequest size={14} /> Pull requests <b>{source.pulls.length}</b>
            </button>
            <button
              aria-pressed={mode === 'branches'}
              onClick={() => {
                setMode('branches');
                setLimit(8);
              }}
            >
              <GitBranch size={14} /> Branches <b>{source.branches.length}</b>
            </button>
          </div>
          <div className="published-rows">
            {!items.length && (
              <p className="published-empty-row">
                No {mode === 'pulls' ? 'pull requests' : 'branches'} match this view.
              </p>
            )}
            {mode === 'pulls'
              ? source.pulls.slice(0, limit).map((pull) => (
                  <a
                    className="published-row pull-row"
                    href={pull.url}
                    target="_blank"
                    rel="noreferrer"
                    key={pull.number}
                  >
                    <span className="published-node">
                      <GitPullRequest size={15} />
                    </span>
                    <span className="published-row-copy">
                      <strong>{pull.title}</strong>
                      <small>
                        #{pull.number} ·{' '}
                        {pull.author ? `@${pull.author.login}` : 'Author unavailable'} ·{' '}
                        {pull.headName} → {pull.base} · updated {dateLabel(pull.updatedAt)}
                      </small>
                    </span>
                    {pull.state !== 'open' && (
                      <span className={`row-chip state ${pull.state}`}>
                        {pull.state === 'merged' ? 'Merged' : 'Closed'}
                      </span>
                    )}
                    {pull.draft && <span className="row-chip draft">Draft</span>}
                    {pull.retained && <span className="row-chip retained">Saved history</span>}
                    {(pull.requestedReviewers.length > 0 || pull.requestedTeams.length > 0) && (
                      <span className="row-chip review">Review requested</span>
                    )}
                    <span className={`row-chip checks ${pull.checks.state}`}>
                      {pull.checks.state === 'passed' ? (
                        <Check size={11} />
                      ) : pull.checks.state === 'failed' ? (
                        <AlertTriangle size={11} />
                      ) : (
                        <CircleDashed size={11} />
                      )}
                      {pull.checks.label}
                    </span>
                    <ArrowUpRight size={14} />
                  </a>
                ))
              : source.branches.slice(0, limit).map((branch) => (
                  <div className="published-row branch-row" key={branch.name + branch.sha}>
                    <span className="published-node">
                      <GitBranch size={15} />
                    </span>
                    <span className="published-row-copy">
                      <strong>{branch.name}</strong>
                      <small>
                        <code>{branch.sha.slice(0, 9)}</code>
                        {branch.pullNumbers.length
                          ? ` · PR ${branch.pullNumbers.map((number) => `#${number}`).join(', ')}`
                          : ' · No matching saved PR'}
                      </small>
                    </span>
                    <span className="published-targets">
                      {branch.targets.map((target) => (
                        <span
                          key={target.name}
                          className={`target-chip ${target.state}`}
                          title={`Compared with ${target.name}${target.checkedAt ? ` · ${dateLabel(target.checkedAt)}` : ''}`}
                        >
                          {target.state === 'integrated' ? (
                            <Check size={10} />
                          ) : target.state === 'unknown' ? (
                            <CircleDashed size={10} />
                          ) : (
                            <span>−</span>
                          )}
                          {target.state === 'integrated'
                            ? `In ${target.name}`
                            : target.state === 'pending'
                              ? `Not in ${target.name}`
                              : `${target.name} unknown`}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
          </div>
          {items.length > limit && (
            <button className="more-branches" onClick={() => setLimit((value) => value + 20)}>
              Show {Math.min(20, items.length - limit)} more {mode} <ChevronDown size={14} />
            </button>
          )}
          {(mode === 'branches' ? source.omittedBranches : source.omittedPulls) > 0 && (
            <p className="published-limit-note">
              {(mode === 'branches'
                ? source.omittedBranches
                : source.omittedPulls
              ).toLocaleString()}{' '}
              additional {mode}{' '}
              {(mode === 'branches' ? source.omittedBranches : source.omittedPulls) === 1
                ? 'match'
                : 'matches'}
              . Narrow the search to inspect them.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function count(value: number, noun: string, plural = noun + 's') {
  return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

function matchCount(value: number, omitted: number, noun: string, plural = noun + 's') {
  const shown = `${value.toLocaleString()}${omitted ? '+' : ''}`;
  return `${shown} matching ${value === 1 && !omitted ? noun : plural}`;
}
