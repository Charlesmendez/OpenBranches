import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Laptop,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import type { ActivityEvent, Branch, Repository } from '../../domain/types';
import { activityItems } from '../../domain/activity';
import { featureBranches, groupCounts, lifecycleLabels } from '../../domain/branches';
import { primaryIntegrationTargets } from '../../domain/integrationTargets';
import { workPreviews } from '../../domain/workSpotlight';
import { useClock } from '../hooks/useClock';
import { WorkSignalIcon } from './WorkSignalIcon';
import { WorkspaceNow } from './WorkspaceNow';
import { ActivityList } from './ActivityList';
export function Overview({
  repositories,
  events,
  demo,
  onProject,
  onActivity,
  onPulls,
  onSources,
  onSelect,
  onFocus,
  onAdd,
}: {
  repositories: Repository[];
  events: ActivityEvent[];
  demo: boolean;
  onProject: (id: string) => void;
  onActivity: () => void;
  onPulls: () => void;
  onSources: () => void;
  onSelect: (repositoryId: string, branchId?: string) => void;
  onFocus: (repository: Repository, branch: Branch) => void;
  onAdd: () => void;
}) {
  const now = useClock();
  const [projectsOpen, setProjectsOpen] = useState(false);
  const activity = activityItems(events, repositories);
  return (
    <div className="overview-content">
      <WorkspaceNow
        repositories={repositories}
        now={now}
        demo={demo}
        onProject={onProject}
        onFocus={onFocus}
        onPulls={onPulls}
        onSources={onSources}
      />
      <section className={`project-directory ${projectsOpen ? 'open' : ''}`}>
        <button
          className="project-directory-toggle"
          aria-expanded={projectsOpen}
          onClick={() => setProjectsOpen((value) => !value)}
        >
          <span className="project-directory-icon">
            <FolderGit2 size={17} />
          </span>
          <span>
            <strong>All projects</strong>
            <small>
              {repositories.length} projects ·{' '}
              {repositories.reduce((sum, repository) => sum + repository.branches.length, 0)} branch
              copies
            </small>
          </span>
          <span>{projectsOpen ? 'Hide directory' : 'Browse project directory'}</span>
          <ChevronDown size={15} />
        </button>
        {projectsOpen && (
          <div className="project-cards">
            {repositories.map((repo, index) => {
              const branches = featureBranches(repo);
              const counts = groupCounts(branches, now);
              const previews = workPreviews(branches, repo.path, now);
              const previewTargets = primaryIntegrationTargets(repo.targets);
              return (
                <button
                  key={repo.id}
                  className={`project-card project-tone-${index % 3}`}
                  onClick={() => onProject(repo.id)}
                >
                  <div className="project-card-head">
                    <span className="project-emblem">
                      <FolderGit2 size={21} strokeWidth={1.5} />
                    </span>
                    <div>
                      <h2>{repo.name}</h2>
                      <span>
                        {counts.active} {lifecycleLabels.active.toLowerCase()} <i />{' '}
                        {repo.branches.length} branch copies
                      </span>
                    </div>
                    <span className="project-open">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <div className="project-route">
                    <div className="route-tasks">
                      {previews.map(({ branch, signal }) => (
                        <div
                          key={branch.id}
                          className={`route-task ${signal ? `work-${signal.kind}` : ''}`}
                        >
                          <span className={branch.pullRequest ? 'violet-dot' : 'blue-dot'} />
                          <span>{branch.title}</span>
                          {(signal || branch.pullRequest) && (
                            <span
                              className="route-task-status"
                              title={signal?.detail}
                              aria-label={
                                signal?.label ?? `Pull request ${branch.pullRequest!.number}`
                              }
                            >
                              {signal ? (
                                <WorkSignalIcon signal={signal} size={13} />
                              ) : (
                                <GitPullRequest size={13} aria-hidden="true" />
                              )}
                              <small>{signal?.label ?? `PR #${branch.pullRequest!.number}`}</small>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="route-connector">
                      <span>Compared with</span>
                    </div>
                    <div className="route-targets">
                      {previewTargets.map((target) => (
                        <span
                          key={target.name}
                          className={`route-target ${target.role === 'default' || target.name === 'master' || target.name === 'main' ? 'stable' : ''}`}
                        >
                          <GitBranch size={14} />
                          {target.name}
                        </span>
                      ))}
                      {repo.targets.length > previewTargets.length && (
                        <span
                          className="route-target-more"
                          title={`${repo.targets.length - previewTargets.length} more integration targets`}
                        >
                          +{repo.targets.length - previewTargets.length}
                        </span>
                      )}
                      {!repo.targets.length && (
                        <span className="muted-note">No targets detected</span>
                      )}
                    </div>
                  </div>
                  <div className="project-card-foot">
                    <span>
                      <Laptop size={13} />
                      {repo.error ? 'Source unavailable' : 'Local repository'}
                    </span>
                    <span>
                      {counts.integrated ? (
                        <>
                          <Check size={12} />
                          {counts.integrated} integrated
                        </>
                      ) : (
                        `${counts.quiet} quiet branches`
                      )}
                      <ChevronRight size={13} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section className="activity-shelf">
        <div className="section-kicker">
          <span>
            <i className="status-dot" />
            JUST CHANGED
          </span>
          <button className="text-button" onClick={onActivity}>
            All activity
            <ArrowUpRight size={13} />
          </button>
        </div>
        <ActivityList items={activity} now={now} onSelect={onSelect} limit={4} />
      </section>
      <div className="overview-note">
        <span>Your projects stay on your Mac. You choose what to connect.</span>
        <button className="text-button" onClick={onAdd}>
          <Plus size={13} />
          Add a project
        </button>
      </div>
    </div>
  );
}
