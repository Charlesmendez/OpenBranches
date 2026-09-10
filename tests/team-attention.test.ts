import { describe, expect, it } from 'vitest';
import type { RemoteSnapshot } from '../src/github/reader';
import type { SharedSnapshot } from '../src/team/protocol';
import { storedAttentionProjection } from '../src/team/attention';
import { projectAttention, STALE_DRAFT_MILLISECONDS } from '../team-service/src/github/attention';
import {
  FORGOTTEN_WORK_MILLISECONDS,
  projectLocalAttention,
} from '../team-service/src/localAttention';

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

  it('keeps stored GitHub projections readable across the local-signal upgrade', () => {
    const legacy = structuredClone(projectAttention(snapshot(), now)) as unknown as {
      items: Array<{ signals: Record<string, unknown> }>;
    };
    for (const item of legacy.items) {
      delete item.signals.localOnly;
      delete item.signals.forgottenWork;
    }
    expect(storedAttentionProjection.parse(legacy).items[0].signals).toMatchObject({
      localOnly: false,
      forgottenWork: false,
    });
  });
});

const localContext = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    deviceId: '33333333-3333-4333-8333-333333333333',
    receivedAt: new Date(now).toISOString(),
    deviceExpiresAt: new Date(now + 86_400_000).toISOString(),
  },
  localSnapshot = (
    overrides: Partial<SharedSnapshot['branches'][number]> = {},
  ): SharedSnapshot => ({
    version: 1,
    observedAt: new Date(now).toISOString(),
    sourceError: false,
    omittedBranches: 0,
    branches: [
      {
        key: '1'.repeat(64),
        name: 'feature/local-checkout',
        detached: false,
        localSha: sha('b'),
        updatedAt: new Date(now - FORGOTTEN_WORK_MILLISECONDS - 1).toISOString(),
        worktrees: { total: 1, available: 1, dirty: 0, changedFiles: 0 },
        integration: [{ name: 'develop', sha: sha('a'), state: 'pending' }],
        tasks: [],
        omittedTasks: 0,
        ...overrides,
      },
    ],
  });

describe('opted-in local attention projection', () => {
  it('combines exact local-only and forgotten evidence into one branch finding', () => {
    const result = projectLocalAttention(localSnapshot(), localContext, now);
    expect(result.counts).toEqual({ findings: 1, localOnly: 1, forgottenWork: 1 });
    expect(result.items[0]).toMatchObject({
      kind: 'local-only',
      priority: 'review',
      branch: 'feature/local-checkout',
      signals: { localOnly: true, forgottenWork: true },
    });
    expect(result.items[0].evidence).toEqual([
      'No tracked remote copy was reported',
      'Last recorded commit was 7 days ago',
      'Not in develop',
    ]);
  });

  it('never treats a different remote SHA as proof that work exists only locally', () => {
    const result = projectLocalAttention(
      localSnapshot({
        updatedAt: new Date(now - 60_000).toISOString(),
        remote: { name: 'origin', sha: sha('c'), presence: 'present' },
      }),
      localContext,
      now,
    );
    expect(result.items).toEqual([]);
    expect(result.counts.localOnly).toBe(0);
  });

  it('requires old, clean, pending work with no fresh runtime activity before calling it forgotten', () => {
    const cases: Array<Partial<SharedSnapshot['branches'][number]>> = [
      { updatedAt: new Date(now - 60_000).toISOString() },
      { worktrees: { total: 1, available: 1, dirty: 1, changedFiles: 2 } },
      { integration: [{ name: 'develop', sha: sha('a'), state: 'integrated' }] },
      {
        integration: [
          { name: 'develop', sha: sha('a'), state: 'integrated' },
          { name: 'main', sha: sha('d'), state: 'pending' },
        ],
      },
      { integration: [{ name: 'develop', sha: sha('a'), state: 'unknown' }] },
      { updatedAt: undefined },
      {
        tasks: [
          {
            key: '2'.repeat(64),
            tool: 'codex',
            association: 'verified',
            status: 'active',
            activitySource: 'codex-runtime',
            checkedAt: new Date(now).toISOString(),
          },
        ],
      },
    ];
    for (const changes of cases) {
      const result = projectLocalAttention(
        localSnapshot({
          remote: { name: 'origin', sha: sha('b'), presence: 'present' },
          ...changes,
        }),
        localContext,
        now,
      );
      expect(result.counts.forgottenWork).toBe(0);
      expect(result.items).toEqual([]);
    }
  });

  it('bounds detailed findings while retaining full signal counts', () => {
    const source = localSnapshot(),
      branches = Array.from({ length: 150 }, (_, index) => ({
        ...source.branches[0],
        key: index.toString(16).padStart(64, '0'),
        name: `feature/local-${index}`,
      }));
    const result = projectLocalAttention({ ...source, branches }, localContext, now);
    expect(result.items).toHaveLength(100);
    expect(result.omitted).toBe(50);
    expect(result.counts).toEqual({ findings: 150, localOnly: 150, forgottenWork: 150 });
  });
});
