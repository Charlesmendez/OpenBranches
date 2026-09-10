import { createHash } from 'node:crypto';
import { sharedTaskActivity } from '../../src/team/activity';
import {
  storedLocalAttentionProjection,
  type LocalAttentionEvidenceItem,
  type StoredLocalAttentionProjection,
} from '../../src/team/attention';
import type { SharedSnapshot } from '../../src/team/protocol';

export const FORGOTTEN_WORK_MILLISECONDS = 7 * 86_400_000;
interface LocalAttentionContext {
  workspaceId: string;
  projectId: string;
  deviceId: string;
  receivedAt: string;
  deviceExpiresAt: string;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Projects evidence already chosen for team sharing. A missing tracked remote
 * is a local-only signal only while no target contains the commit; SHA
 * inequality alone never becomes one. */
export function projectLocalAttention(
  snapshot: SharedSnapshot,
  context: LocalAttentionContext,
  now = Date.now(),
): StoredLocalAttentionProjection {
  const work = {
      deviceExpiresAt: context.deviceExpiresAt,
      receivedAt: context.receivedAt,
      snapshot,
    },
    findings: LocalAttentionEvidenceItem[] = [];
  let localOnlyCount = 0,
    forgottenCount = 0;
  for (const branch of snapshot.branches) {
    const pending = branch.integration.filter((target) => target.state === 'pending'),
      integrated = branch.integration.some((target) => target.state === 'integrated'),
      localOnly =
        !branch.detached &&
        !!branch.localSha &&
        pending.length > 0 &&
        !integrated &&
        (!branch.remote || branch.remote.presence === 'missing'),
      updated = Date.parse(branch.updatedAt ?? ''),
      forgotten =
        !branch.detached &&
        !!branch.localSha &&
        pending.length > 0 &&
        !integrated &&
        Number.isFinite(updated) &&
        updated <= now - FORGOTTEN_WORK_MILLISECONDS &&
        branch.worktrees.dirty === 0 &&
        !sharedTaskActivity(work, branch, now);
    if (localOnly) localOnlyCount++;
    if (forgotten) forgottenCount++;
    if (!localOnly && !forgotten) continue;
    const age = Number.isFinite(updated)
        ? Math.max(0, Math.floor((now - updated) / 86_400_000))
        : undefined,
      evidence = [
        ...(localOnly
          ? [
              branch.remote?.presence === 'missing'
                ? `${branch.remote.name} no longer reports this branch`
                : 'No tracked remote copy was reported',
            ]
          : []),
        ...(forgotten && age !== undefined ? [`Last recorded commit was ${age} days ago`] : []),
        `Not in ${pending
          .slice(0, 2)
          .map((target) => target.name)
          .join(' or ')}`,
        ...(branch.worktrees.changedFiles
          ? [
              `${branch.worktrees.changedFiles} changed file${branch.worktrees.changedFiles === 1 ? '' : 's'} reported`,
            ]
          : []),
      ];
    findings.push({
      id: digest([1, context.workspaceId, context.projectId, context.deviceId, branch.key]),
      revision: digest([
        1,
        branch.key,
        branch.localSha,
        branch.updatedAt ?? null,
        branch.remote ? [branch.remote.name, branch.remote.sha, branch.remote.presence] : null,
        branch.worktrees,
        branch.integration.map((target) => [target.name, target.sha, target.state]),
        localOnly,
        forgotten,
      ]),
      kind: localOnly ? 'local-only' : 'forgotten-work',
      priority: localOnly ? 'review' : 'cleanup',
      title: localOnly
        ? `${branch.name} has no tracked remote copy`
        : `${branch.name} may have been left behind`,
      branch: branch.name,
      branchKey: branch.key,
      localSha: branch.localSha!,
      deviceId: context.deviceId,
      tools: [...new Set(branch.tasks.map((task) => task.tool))].slice(0, 5),
      evidence: evidence.slice(0, 4),
      observedAt: snapshot.observedAt,
      updatedAt: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
      signals: {
        failingChecks: false,
        reviewRequested: false,
        staleDraft: false,
        mergedBranch: false,
        localOnly,
        forgottenWork: forgotten,
      },
    });
  }
  findings.sort(
    (a, b) =>
      Number(b.signals.localOnly) - Number(a.signals.localOnly) ||
      (a.updatedAt ?? a.observedAt).localeCompare(b.updatedAt ?? b.observedAt) ||
      a.branch.localeCompare(b.branch),
  );
  return storedLocalAttentionProjection.parse({
    version: 1,
    observedAt: snapshot.observedAt,
    counts: {
      findings: findings.length,
      localOnly: localOnlyCount,
      forgottenWork: forgottenCount,
    },
    items: findings.slice(0, 100),
    omitted: Math.max(0, findings.length - 100),
  });
}
