import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Branch, Recommendation, Repository, ReviewDecision } from './types';

export const SNOOZE_MS = 7 * 86_400_000;
const compare = (a: unknown, b: unknown) =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const sorted = (value: Record<string, unknown> | undefined) =>
  Object.entries(value ?? {}).sort(([a], [b]) => compare(a, b));
// Only semantic evidence belongs here. Observation timestamps, daily age labels,
// and unrelated target-tip advances must not repeatedly undo the user's choice.
export function recommendationRevision(repository: Repository, branch: Branch): string {
  const ref = (value: Branch['local']) =>
    value ? [value.fullName, value.sha, value.upstream, value.source, value.presence] : null;
  const evidence = [
    1,
    branch.name,
    branch.updatedAt,
    branch.detached,
    repository.shallow,
    ref(branch.local),
    ref(branch.remote),
    sorted(branch.integration),
    sorted(branch.remoteIntegration),
    repository.targets
      .map((target) => [target.name, target.source])
      .sort(([a], [b]) => compare(a, b)),
    branch.worktrees
      .map((tree) => [
        tree.path,
        tree.head,
        tree.branch,
        tree.available,
        tree.dirty,
        tree.changedFiles,
        tree.detached,
        tree.locked,
        tree.prunable,
      ])
      .sort((a, b) => compare(a[0], b[0])),
    branch.tasks
      ?.map((task) => [
        task.id,
        task.title,
        task.status,
        task.association,
        task.archived ?? false,
        task.updatedAt,
      ])
      .sort((a, b) => compare(a[0], b[0])) ?? [],
    branch.pullRequest
      ? [
          branch.pullRequest.number,
          branch.pullRequest.state,
          branch.pullRequest.draft ?? false,
          branch.pullRequest.base,
          branch.pullRequest.headSha,
          branch.pullRequest.updatedAt,
        ]
      : null,
    repository.github ? [repository.github.partial, !!repository.github.error] : null,
  ];
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(evidence))));
}
export type ReviewBucket = 'active' | 'snoozed' | 'dismissed';
export interface ReviewedFinding {
  finding: Recommendation;
  decision?: ReviewDecision;
  changed: boolean;
}
export type ReviewGroups = Record<ReviewBucket, ReviewedFinding[]>;
export function groupReviews(
  recommendations: Recommendation[],
  decisions: ReviewDecision[],
  now = Date.now(),
): ReviewGroups {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const groups: ReviewGroups = { active: [], snoozed: [], dismissed: [] };
  for (const finding of recommendations) {
    const previous = byId.get(finding.id);
    const decision = previous?.revision === finding.revision ? previous : undefined;
    // A backward clock must not turn a saved future snooze into an indefinite hide.
    const valid = decision && decision.decidedAt <= now;
    const bucket =
      valid && decision.choice === 'dismissed'
        ? 'dismissed'
        : valid && decision.choice === 'snoozed' && decision.until! > now
          ? 'snoozed'
          : 'active';
    groups[bucket].push({ finding, decision, changed: !!previous && !decision });
  }
  return groups;
}
