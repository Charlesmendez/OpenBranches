import { AgentBadges } from './AgentBadges';
import { PullPeople } from './PullPeople';
import { ArrowUpRight, Check, Copy, GitBranch, X } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { relativeTime } from '../../domain/branches';
import { BranchStatus, IconButton } from './Primitives';
import { lazy, Suspense, useState } from 'react';
import { TaskDetails } from './TaskDetails';
import { IntegrationEvidence } from './IntegrationEvidence';
import { pullSourceStale } from '../../domain/sourceFreshness';
import { BranchActivity } from './BranchActivity';
import { PullRequestEvidence } from './PullRequestEvidence';
import { WorktreeLocations } from './WorktreeLocations';
const PullSignals = lazy(() =>
  import('./PullSignals').then((module) => ({ default: module.PullSignals })),
);

export function Inspector({
  branch,
  repository,
  demo,
  close,
  onError,
}: {
  branch: Branch;
  repository: Repository;
  demo: boolean;
  close: () => void;
  onError: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const openPr = async () => {
    if (demo) {
      onError('PR numbers in the demo are fictional.');
      return;
    }
    if (branch.pullRequest)
      await window.openbranches
        ?.openExternal(branch.pullRequest.url)
        .catch((error) => onError(String(error)));
  };
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(branch.name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError('Could not copy the branch name.');
    }
  };
  return (
    <aside className="inspector" aria-label="Branch details">
      <div className="inspector-eyebrow">
        <span>BRANCH DETAILS</span>
        <IconButton icon={X} label="Close branch details" onClick={close} />
      </div>
      <div className="inspector-title">
        <span className="branch-glyph">
          <GitBranch size={20} />
        </span>
        <h2>{branch.title}</h2>
        <BranchStatus branch={branch} />
      </div>
      <div className="ref-copy">
        <code>{branch.name}</code>
        <IconButton
          icon={copied ? Check : Copy}
          label="Copy branch name"
          onClick={() => void copyName()}
        />
      </div>
      <AgentBadges branch={branch} />
      <BranchActivity branch={branch} />
      <PullRequestEvidence branch={branch} />
      {branch.pullRequest &&
      (branch.pullRequest.author ||
        branch.pullRequest.requestedReviewers?.length ||
        branch.pullRequest.requestedTeams?.length) ? (
        <div className="inspector-pr-people">
          <PullPeople pull={branch.pullRequest} />
        </div>
      ) : null}
      {branch.pullRequest?.signals && (
        <Suspense fallback={<p className="muted-note">Loading PR evidence…</p>}>
          <PullSignals
            headSha={branch.pullRequest.headSha}
            signals={branch.pullRequest.signals}
            demo={demo}
            demoNow={Date.parse(repository.github?.checkedAt ?? '') + 60_000}
            open={branch.pullRequest.state === 'open'}
            unavailable={
              !!repository.github?.error ||
              pullSourceStale({
                ...branch.pullRequest,
                observedAt: branch.pullRequest.observedAt ?? repository.github?.checkedAt ?? '',
              })
            }
          />
        </Suspense>
      )}
      <IntegrationEvidence key={`history:${branch.id}`} branch={branch} repository={repository} />
      <WorktreeLocations branch={branch} repository={repository} demo={demo} onError={onError} />
      <TaskDetails
        key={`${demo}:${repository.id}:${branch.id}`}
        tasks={branch.tasks ?? []}
        repositoryId={repository.id}
        branchId={branch.id}
        demo={demo}
      />
      <section className="inspector-section compact-section">
        <div className="last-checked">
          <span>Evidence checked</span>
          <span>{relativeTime(repository.scannedAt)}</span>
        </div>
      </section>
      {branch.pullRequest && (
        <div className="inspector-actions">
          <button className="primary-button" onClick={() => void openPr()}>
            View PR #{branch.pullRequest.number}
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
