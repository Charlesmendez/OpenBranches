import { GitPullRequest, Search, TriangleAlert } from 'lucide-react';
import type { Branch } from '../../domain/types';
import { relativeTime } from '../../domain/branches';

export function PullRequestEvidence({ branch }: { branch: Branch }) {
  const lookup = branch.pullLookup;
  if (branch.pullRequest || !lookup) return null;
  const unavailable = !!lookup.error;
  const title = unavailable
    ? 'Older PR check unavailable'
    : !lookup.complete
      ? 'Checking older PR history'
      : lookup.found
        ? 'PR identity did not match this branch'
        : 'No PR found for this exact commit';
  const detail = unavailable
    ? `${lookup.error} Last attempted ${relativeTime(lookup.checkedAt).toLowerCase()}.`
    : !lookup.complete
      ? 'GitHub is continuing this exact-commit lookup in a later refresh.'
      : lookup.found
        ? 'GitHub returned a PR for this commit, but its current branch name did not match. OpenBranches did not attach it.'
        : `GitHub checked this branch tip ${relativeTime(lookup.checkedAt).toLowerCase()}.`;
  const Icon = unavailable ? TriangleAlert : lookup.complete ? GitPullRequest : Search;
  return (
    <section className="inspector-section pull-lookup" aria-label="Pull request evidence">
      <h3>Pull request evidence</h3>
      <div className="location-detail">
        <Icon size={18} />
        <div>
          <strong>{title}</strong>
          <small>{detail}</small>
        </div>
      </div>
    </section>
  );
}
