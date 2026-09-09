import { useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, GitPullRequest, Search, Users, X } from 'lucide-react';
import type { Repository } from '../../domain/types';
import {
  collaborationIndex,
  matchingPulls,
  peopleFor,
  pullSourceStale,
  quietDraft,
  reviewRequested,
  workTools,
  type PullFilter,
} from '../../domain/collaboration';
import { toolNames } from '../../domain/agents';
import { PersonAvatar } from './PullPeople';
import { PeoplePullCard } from './PeoplePullCard';
import './people.css';
import type { NavigationMemory, WorkspaceMode } from '../navigationMemory';
import { usePeoplePosition } from '../hooks/usePeoplePosition';

export function People({
  repositories,
  demo,
  onSelect,
  onSettings,
  navigation,
  mode,
}: {
  repositories: Repository[];
  demo: boolean;
  onSelect: (repositoryId: string, branchId: string) => void;
  onSettings: () => void;
  navigation: NavigationMemory;
  mode: WorkspaceMode;
}) {
  const work = useMemo(() => collaborationIndex(repositories), [repositories]);
  const { position, update } = usePeoplePosition(navigation, mode);
  const { query, person, project, tool, filter, page, peoplePage } = position;
  const setQuery = (query: string) => update({ query });
  const setPerson = (person: string | null) => update({ person });
  const setProject = (project: string) => update({ project });
  const setTool = (tool: string) => update({ tool });
  const setFilter = (filter: PullFilter) => update({ filter });
  const setPage = (page: number) => update({ page });
  const setPeoplePage = (peoplePage: number) => update({ peoplePage });
  const scoped = useMemo(
    () => matchingPulls(work, { query, person: null, project, tool, filter }),
    [work, query, project, tool, filter],
  );
  const people = useMemo(() => peopleFor(scoped), [scoped]);
  const matches = useMemo(
    () => matchingPulls(scoped, { query: '', person, project: 'all', tool: 'all', filter }),
    [scoped, person, filter],
  );
  useEffect(() => {
    if (person && !people.some((item) => item.id === person)) setPerson(null);
  }, [people, person]);
  const projectOptions = [...new Set(work.map(({ pull }) => pull.repository.toLowerCase()))].sort();
  const toolOptions = [...new Set(work.flatMap(workTools))].sort((a, b) =>
    toolNames[a].localeCompare(toolNames[b]),
  );
  useEffect(() => {
    if (project !== 'all' && !projectOptions.includes(project)) setProject('all');
    if (tool !== 'all' && !toolOptions.some((value) => value === tool)) setTool('all');
  }, [projectOptions.join('|'), toolOptions.join('|'), project, tool]);
  const selected = people.find((item) => item.id === person);
  const pages = Math.max(1, Math.ceil(matches.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const rosterPages = Math.max(1, Math.ceil(people.length / 8));
  const rosterPage = Math.min(peoplePage, rosterPages - 1);
  const observedProjects = repositories.filter((repository) => repository.github);
  const complete =
    observedProjects.length > 0 &&
    observedProjects.every((repository) => repository.github?.openPullsComplete === true);
  const unobserved = repositories.length - observedProjects.length;
  const stale = work.some(({ pull }) => pullSourceStale(pull));
  const openCount = work.filter(({ pull }) => pull.state === 'open').length;
  const metrics: { key: PullFilter; label: string; count: number; hint: string }[] = [
    {
      key: 'open',
      label: 'Open pull requests',
      count: openCount,
      hint: 'Across connected projects',
    },
    {
      key: 'requested',
      label: 'Review requested',
      count: work.filter(({ pull }) => reviewRequested(pull)).length,
      hint: 'People or teams requested',
    },
    {
      key: 'quiet-drafts',
      label: 'Quiet drafts',
      count: work.filter(({ pull }) => quietDraft(pull)).length,
      hint: 'No PR update in 14 days',
    },
    {
      key: 'history',
      label: 'Recent history',
      count: work.filter(({ pull }) => pull.state !== 'open').length,
      hint: 'Merged and closed PRs',
    },
  ];
  return (
    <section className="people-workspace" aria-label="People and pull requests">
      <div className="people-scope">
        <span>
          <Users size={15} />
          {demo ? 'Fictional team activity' : 'GitHub collaboration'}
        </span>
        <span>{demo ? 'Explore with sample data' : 'From repositories connected on this Mac'}</span>
      </div>
      <div className="people-metrics">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            className={filter === metric.key ? 'selected' : ''}
            aria-pressed={filter === metric.key}
            onClick={() => setFilter(metric.key)}
          >
            <span>{metric.label}</span>
            <strong>{metric.count}</strong>
            <small>{metric.hint}</small>
          </button>
        ))}
      </div>
      <div className="people-filters">
        <label className="people-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a person, project, PR, or tool…"
            aria-label="Search people and pull requests"
          />
          {query && (
            <button aria-label="Clear people search" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter pull requests by project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="all">All projects</option>
          {projectOptions.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter pull requests by coding tool"
          value={tool}
          onChange={(event) => setTool(event.target.value)}
        >
          <option value="all">All tools</option>
          {toolOptions.map((value) => (
            <option key={value} value={value}>
              {toolNames[value]}
            </option>
          ))}
        </select>
      </div>
      {(!complete || stale || unobserved > 0) && !demo && (
        <p className="people-coverage" role="status">
          {stale ? 'Some GitHub evidence is outdated. ' : ''}
          {!complete ? 'Open PR coverage is incomplete. ' : ''}
          {unobserved
            ? unobserved +
              (unobserved === 1 ? ' project has' : ' projects have') +
              ' not supplied GitHub data. '
            : ''}
          Counts describe the available snapshot.{' '}
          <button className="text-button" onClick={onSettings}>
            Review connections
          </button>
        </p>
      )}
      {filter === 'history' && (
        <p className="people-history-note">
          Recent history is a bounded snapshot. Older closed or merged PRs may not appear.
        </p>
      )}
      <div className="people-layout">
        <aside className="people-roster" aria-label="PR authors and requested reviewers">
          <div className="section-kicker">
            <span>PEOPLE & BOTS</span>
            <span>{people.filter((item) => item.actor).length}</span>
          </div>
          <button
            className={'person-all ' + (person === null ? 'selected' : '')}
            aria-pressed={person === null}
            onClick={() => setPerson(null)}
          >
            <Users size={17} />
            <span>Everyone in this view</span>
          </button>
          {people.slice(rosterPage * 8, (rosterPage + 1) * 8).map((item) => (
            <button
              key={item.id}
              className={'person-row ' + (person === item.id ? 'selected' : '')}
              aria-pressed={person === item.id}
              onClick={() => setPerson(item.id)}
            >
              <PersonAvatar actor={item.actor} />
              <span>
                <strong>
                  {item.actor?.login ?? 'Author unavailable'}
                  {item.actor?.kind === 'bot' ? ' · Bot' : ''}
                </strong>
                <small>
                  {item.authored} authored · {item.requested} to review
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
          {rosterPages > 1 && (
            <div className="people-pagination">
              <button
                aria-label="Previous people"
                disabled={!rosterPage}
                onClick={() => setPeoplePage(rosterPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {rosterPage + 1} / {rosterPages}
              </span>
              <button
                aria-label="Next people"
                disabled={rosterPage === rosterPages - 1}
                onClick={() => setPeoplePage(rosterPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <p className="people-roster-note">
            These people appear because they authored a PR or were requested to review it.
          </p>
        </aside>
        <div className="people-work">
          <div className="people-work-title">
            <div>
              <h2>
                {selected
                  ? (selected.actor?.login ?? 'Author unavailable')
                  : filter === 'requested'
                    ? 'Ready for another pair of eyes.'
                    : filter === 'quiet-drafts'
                      ? 'Worth picking up again.'
                      : filter === 'history'
                        ? 'Work that has moved on.'
                        : 'Work in motion.'}
              </h2>
              <p>
                {matches.length} {matches.length === 1 ? 'pull request' : 'pull requests'}
                {selected
                  ? filter === 'history'
                    ? ' authored'
                    : ' authored or awaiting their review'
                  : ' in this view'}
              </p>
            </div>
            {person && (
              <button className="text-button" onClick={() => setPerson(null)}>
                Everyone
                <X size={13} />
              </button>
            )}
          </div>
          {matches.slice(currentPage * 12, (currentPage + 1) * 12).map((item) => (
            <PeoplePullCard key={item.id} work={item} demo={demo} onSelect={onSelect} />
          ))}
          {!matches.length && (
            <div className="people-empty">
              <GitPullRequest size={27} />
              <h3>{work.length ? 'Nothing in this view.' : 'Bring the work into view.'}</h3>
              <p>
                {work.length
                  ? 'Try another person, project, or search.'
                  : 'Connect GitHub to see PR authors and review requests from your projects.'}
              </p>
              {!work.length && (
                <button className="secondary-button" onClick={onSettings}>
                  Open connections
                </button>
              )}
              {!!work.length && (
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setPerson(null);
                    setProject('all');
                    setTool('all');
                    setFilter('open');
                  }}
                >
                  Show all open PRs
                </button>
              )}
            </div>
          )}
          {pages > 1 && (
            <div className="people-pagination">
              <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft size={16} />
                Previous
              </button>
              <span>
                Page {currentPage + 1} of {pages}
              </span>
              <button disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="people-sharing-note">
        <span className="status-dot muted" />
        Team sharing is still in development. Your local work stays on this Mac.
      </p>
    </section>
  );
}
