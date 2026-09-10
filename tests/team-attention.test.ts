import { describe, expect, it } from 'vitest';
import type { RemoteSnapshot } from '../src/github/reader';
import { projectAttention, STALE_DRAFT_MILLISECONDS } from '../team-service/src/github/attention';

const now = Date.UTC(2026, 8, 9, 20, 0, 0),
  sha = (value: string) => value.repeat(40),
  snapshot = (checkedAt = new Date(now).toISOString()): RemoteSnapshot => ({
    repository: 'FictionalOrg/atlas',
    remoteName: 'origin',
    checkedAt,
    branchesComplete: true,
    pullHistoryComplete: true,
    openPullsComplete: true,
    branches: [
      { name: 'develop', sha: sha('a') },
      { name: 'feature/merged-copy', sha: sha('d') },
    ],
    pulls: [
      {
        number: 1,
        title: 'Repair checkout',
        url: 'https://github.com/FictionalOrg/atlas/pull/1',
        state: 'open',
        draft: false,
        base: 'develop',
        headSha: sha('b'),
        updatedAt: new Date(now - 60_000).toISOString(),
        headName: 'feature/checkout',
        headRepository: 'FictionalOrg/atlas',
        requestedReviewers: [{ id: '62', login: 'maya', kind: 'user' }],
        signals: {
          headSha: sha('b'),
          attemptedAt: new Date(now).toISOString(),
          checks: {
            observedAt: new Date(now).toISOString(),
            complete: true,
            total: 1,
            counts: { failed: 1, pending: 0, passed: 0, other: 0 },
            items: [{ id: '1', name: 'Build', kind: 'check', state: 'failed', result: 'failure' }],
          },
        },
      },
      {
        number: 2,
        title: 'Try a quieter navigation',
        url: 'https://github.com/FictionalOrg/atlas/pull/2',
        state: 'open',
        draft: true,
        base: 'develop',
        headSha: sha('c'),
        updatedAt: new Date(now - STALE_DRAFT_MILLISECONDS - 1).toISOString(),
        headName: 'draft/navigation',
        headRepository: 'FictionalOrg/atlas',
      },
      {
        number: 3,
        title: 'Merged release helper',
        url: 'https://github.com/FictionalOrg/atlas/pull/3',
        state: 'merged',
        base: 'develop',
        headSha: sha('d'),
        updatedAt: new Date(now - 3_600_000).toISOString(),
        headName: 'feature/merged-copy',
        headRepository: 'FictionalOrg/atlas',
      },
      {
        number: 4,
        title: 'Closed without merge',
        url: 'https://github.com/FictionalOrg/atlas/pull/4',
        state: 'closed',
        base: 'develop',
        headSha: sha('e'),
        updatedAt: new Date(now - 3_600_000).toISOString(),
        headName: 'feature/closed',
        headRepository: 'FictionalOrg/atlas',
      },
    ],
  });

describe('team attention projection', () => {
  it('makes one ranked finding per PR and retains every applicable evidence signal', () => {
    const result = projectAttention(snapshot(), now);
    expect(result.counts).toEqual({
      findings: 3,
      failingChecks: 1,
      reviewRequested: 1,
      staleDrafts: 1,
      mergedBranches: 1,
    });
    expect(result.items.map((item) => item.kind)).toEqual([
      'checks-failing',
      'stale-draft',
      'merged-branch',
    ]);
    expect(result.items[0]).toMatchObject({
      pullNumber: 1,
      priority: 'urgent',
      requestedReviewerIds: ['62'],
      signals: { failingChecks: true, reviewRequested: true },
    });
    expect(result.items[2].evidence[0]).toContain('still points to the merged commit');
  });

  it('keeps stable identities across observations and changes revisions only with semantic evidence', () => {
    const first = projectAttention(snapshot(), now),
      later = projectAttention(snapshot(new Date(now + 60_000).toISOString()), now + 60_000);
    expect(later.items[0].id).toBe(first.items[0].id);
    expect(later.items[0].revision).toBe(first.items[0].revision);
    const changed = snapshot();
    changed.pulls[0].requestedReviewers = [];
    const refreshed = projectAttention(changed, now);
    expect(refreshed.items[0].id).toBe(first.items[0].id);
    expect(refreshed.items[0].revision).not.toBe(first.items[0].revision);
    const renamed = snapshot();
    renamed.repository = 'FictionalOrg/atlas-renamed';
    renamed.pulls.forEach((pull) => (pull.headRepository = renamed.repository));
    expect(projectAttention(renamed, now, '51').items[0].id).toBe(
      projectAttention(snapshot(), now, '51').items[0].id,
    );
  });

  it('does not treat stale check data, age alone, or a reused branch name as action evidence', () => {
    const value = snapshot();
    value.pulls[0].requestedReviewers = [];
    value.pulls[0].signals!.checks!.observedAt = new Date(now - 11 * 60_000).toISOString();
    value.pulls[1].draft = false;
    value.branches[1].sha = sha('f');
    expect(projectAttention(value, now).items).toEqual([]);
  });
});
