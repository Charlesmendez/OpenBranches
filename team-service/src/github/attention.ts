import { createHash } from 'node:crypto';
import { checksSummary } from '../../../src/domain/pullSignals';
import type { RemoteSnapshot } from '../../../src/github/reader';
import {
  storedAttentionProjection,
  type AttentionEvidenceItem,
  type StoredAttentionProjection,
} from '../../../src/team/attention';

export const STALE_DRAFT_MILLISECONDS = 7 * 86_400_000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDate = (value: string) => Number.isFinite(Date.parse(value));

/** Creates a bounded, explainable queue from one immutable GitHub snapshot.
 * One PR becomes one finding even when several signals apply. */
export function projectAttention(
  snapshot: RemoteSnapshot,
  now = Date.now(),
  repositoryKey = snapshot.repository,
): StoredAttentionProjection {
  const observedAt = validDate(snapshot.checkedAt)
      ? new Date(snapshot.checkedAt).toISOString()
      : new Date(0).toISOString(),
    branchKeys = new Set(snapshot.branches.map((branch) => `${branch.name}\0${branch.sha}`)),
    findings: AttentionEvidenceItem[] = [];
  let failingChecks = 0,
    reviewRequested = 0,
    staleDrafts = 0,
    mergedBranches = 0;
  for (const pull of snapshot.pulls) {
    if (!validDate(pull.updatedAt) || !/^[a-f\d]{40,64}$/.test(pull.headSha)) continue;
    const current = !pull.retained,
      checks = checksSummary(pull.headSha, pull.signals, now),
      failed = current && pull.state === 'open' && checks.state === 'failed',
      review =
        current &&
        pull.state === 'open' &&
        !!((pull.requestedReviewers?.length ?? 0) + (pull.requestedTeams?.length ?? 0)),
      staleDraft =
        current &&
        pull.state === 'open' &&
        pull.draft === true &&
        Date.parse(pull.updatedAt) <= now - STALE_DRAFT_MILLISECONDS,
      mergedBranch =
        pull.state === 'merged' &&
        pull.headRepository === snapshot.repository &&
        branchKeys.has(`${pull.headName}\0${pull.headSha}`);
    if (failed) failingChecks++;
    if (review) reviewRequested++;
    if (staleDraft) staleDrafts++;
    if (mergedBranch) mergedBranches++;
    if (!failed && !review && !staleDraft && !mergedBranch) continue;
    const kind = failed
        ? ('checks-failing' as const)
        : review
          ? ('review-requested' as const)
          : staleDraft
            ? ('stale-draft' as const)
            : ('merged-branch' as const),
      reviewerIds = (pull.requestedReviewers ?? []).map((actor) => actor.id).sort(),
      teamIds = (pull.requestedTeams ?? []).map((team) => team.id).sort(),
      semanticEvidence = [
        1,
        snapshot.repository,
        pull.number,
        pull.state,
        pull.draft ?? false,
        pull.headRepository,
        pull.headName,
        pull.headSha,
        pull.base,
        pull.updatedAt,
        reviewerIds,
        teamIds,
        checks.state,
        checks.label,
        mergedBranch,
      ];
    const evidence = [
      ...(failed ? [checks.label] : []),
      ...(review
        ? [
            `${(pull.requestedReviewers?.length ?? 0) + (pull.requestedTeams?.length ?? 0)} reviewer${(pull.requestedReviewers?.length ?? 0) + (pull.requestedTeams?.length ?? 0) === 1 ? '' : 's'} requested`,
          ]
        : []),
      ...(staleDraft
        ? [
            `Draft has no updates for ${Math.max(7, Math.floor((now - Date.parse(pull.updatedAt)) / 86_400_000))} days`,
          ]
        : []),
      ...(mergedBranch ? [`${pull.headName} still points to the merged commit`] : []),
    ];
    findings.push({
      id: digest([1, repositoryKey, pull.number]),
      revision: digest(semanticEvidence),
      kind,
      priority: failed ? 'urgent' : review || staleDraft ? 'review' : 'cleanup',
      title: failed
        ? `PR #${pull.number} has failing checks`
        : review
          ? `PR #${pull.number} is waiting for review`
          : staleDraft
            ? `Draft PR #${pull.number} has gone quiet`
            : `Merged branch ${pull.headName} is still published`,
      pullTitle: pull.title,
      pullNumber: pull.number,
      url: pull.url,
      branch: pull.headName,
      base: pull.base,
      author: pull.author?.login ?? null,
      requestedReviewerIds: reviewerIds,
      evidence: evidence.slice(0, 4),
      observedAt,
      updatedAt: new Date(pull.updatedAt).toISOString(),
      signals: {
        failingChecks: failed,
        reviewRequested: review,
        staleDraft,
        mergedBranch,
        localOnly: false,
        forgottenWork: false,
      },
    });
  }
  findings.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      Number(b.signals.reviewRequested) - Number(a.signals.reviewRequested) ||
      a.updatedAt.localeCompare(b.updatedAt) ||
      a.pullNumber - b.pullNumber,
  );
  return storedAttentionProjection.parse({
    version: 1,
    observedAt,
    counts: {
      findings: findings.length,
      failingChecks,
      reviewRequested,
      staleDrafts,
      mergedBranches,
    },
    items: findings.slice(0, 100),
    omitted: Math.max(0, findings.length - 100),
  });
}

const priority = (item: AttentionEvidenceItem) =>
  item.priority === 'urgent' ? 0 : item.priority === 'review' ? 1 : 2;
