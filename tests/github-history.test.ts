import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubHttp } from '../electron/github/http';
import { comparisonState, readHistory, type RemoteHistory } from '../src/github/history';
import { enrichRepository } from '../electron/github/enrich';
import { readRemote, type RemoteSnapshot } from '../src/github/reader';
import type { Repository } from '../src/domain/types';
import { recommendationRevision } from '../src/domain/reviews';
import { prepareAnalysis } from '../electron/advisor/packet';
import { validateFindings } from '../electron/advisor/findings';

const hash = (n: number) => n.toString(16).padStart(40, '0');
const at = new Date().toISOString();
const body = (
  status: 'ahead' | 'behind' | 'diverged' | 'identical',
  branchSha = hash(2),
  targetSha = hash(1),
) => ({
  status,
  ahead_by: ['ahead', 'diverged'].includes(status) ? 8 : 0,
  behind_by: ['behind', 'diverged'].includes(status) ? 3 : 0,
  base_commit: { sha: targetSha },
  merge_base_commit: {
    sha: status === 'behind' ? branchSha : status === 'diverged' ? hash(9999) : targetSha,
  },
  commits: [], // A page is never evidence that the complete comparison is empty.
  files: [{ patch: 'Private patch must not be retained' }],
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const httpFor = (request: typeof fetch) => new GitHubHttp(async () => undefined, request);
const branches = [
  { name: 'develop', sha: hash(1) },
  { name: 'codex/work', sha: hash(2) },
];
function repository(): Repository {
  return {
    id: 'fixture',
    name: 'Fixture',
    path: '/fixture',
    commonDir: '/fixture/.git',
    scannedAt: at,
    shallow: false,
    remotes: [{ name: 'origin', url: 'https://github.com/example/fixture' }],
    worktrees: [],
    targets: [{ name: 'develop', sha: hash(1), source: 'local' }],
    branches: [
      {
        id: 'work',
        repositoryId: 'fixture',
        name: 'codex/work',
        title: 'Work',
        codexNamed: true,
        detached: false,
        updatedAt: '2026-08-01T00:00:00.000Z',
        worktrees: [],
        integration: { develop: 'integrated' },
        remoteIntegration: { develop: 'pending' },
        local: {
          name: 'codex/work',
          fullName: 'refs/heads/codex/work',
          upstream: 'refs/remotes/origin/codex/work',
          sha: hash(3),
          updatedAt: at,
          subject: '',
        },
        remote: {
          name: 'codex/work',
          fullName: 'refs/remotes/origin/codex/work',
          remote: 'origin',
          sha: hash(2),
          updatedAt: at,
          subject: '',
        },
      },
    ],
  };
}
function source(history?: RemoteHistory): RemoteSnapshot {
  return {
    repository: 'example/fixture',
    remoteName: 'origin',
    branches,
    pulls: [],
    checkedAt: at,
    branchesComplete: true,
    pullHistoryComplete: true,
    history,
  };
}
afterEach(() => vi.useRealTimers());

describe('immutable GitHub ancestry', () => {
  it('stops metadata pagination after disconnect and timestamps the beginning of a slow snapshot', async () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    let current = true;
    const cancelled = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return response([]);
    });
    await expect(
      readRemote(httpFor(cancelled), 'example/fixture', 'origin', { isCurrent: () => current }),
    ).rejects.toThrow('cancelled');
    expect(cancelled).toHaveBeenCalledTimes(1);
    const slow = vi.fn<typeof fetch>().mockImplementation(async () => {
      vi.advanceTimersByTime(30_000);
      return response([]);
    });
    expect((await readRemote(httpFor(slow), 'example/fixture', 'origin')).checkedAt).toBe(
      startedAt,
    );
  });

  it('shares request and elapsed-time bounds across sources', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      vi.advanceTimersByTime(20_000);
      return response(body('behind'));
    });
    const budget = { remaining: 12, milliseconds: 30_000 };
    for (const slug of ['example/one', 'example/two', 'example/three'])
      await readHistory(httpFor(request), slug, branches, { budget });
    expect(request).toHaveBeenCalledTimes(2);
    const requests = { remaining: 1, milliseconds: 300_000 };
    for (const slug of ['example/one', 'example/two'])
      await readHistory(httpFor(request), slug, branches, { budget: requests });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([
    ['ahead', 'pending'],
    ['diverged', 'pending'],
    ['behind', 'integrated'],
    ['identical', 'integrated'],
  ] as const)(
    'interprets %s against a target, independent of the returned page',
    (status, expected) => {
      const branch = status === 'identical' ? hash(1) : hash(2);
      expect(comparisonState(body(status, branch), branch, hash(1))).toBe(expected);
    },
  );

  it('rejects a wrong target, invalid direction, or mismatched merge base', () => {
    expect(() => comparisonState(body('behind'), hash(2), hash(4))).toThrow('target');
    expect(() => comparisonState({ ...body('behind'), ahead_by: 1 }, hash(2), hash(1))).toThrow(
      'inconsistent',
    );
    expect(() => comparisonState(body('behind', hash(9)), hash(2), hash(1))).toThrow(
      'inconsistent',
    );
    expect(() => comparisonState(body('identical'), hash(2), hash(1))).toThrow('inconsistent');
  });

  it('requests exact SHAs without patches and caches only matching pairs', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body('behind')));
    const http = httpFor(request);
    const first = await readHistory(http, 'example/fixture', branches);
    expect(first.checks.find((check) => check.branchSha === hash(2))?.state).toBe('integrated');
    expect(String(request.mock.calls[0][0])).toBe(
      `https://api.github.com/repos/example/fixture/compare/${hash(1)}...${hash(2)}?per_page=1&page=2`,
    );
    expect(JSON.stringify(first)).not.toContain('Private patch');
    await readHistory(http, 'example/fixture', branches, { previous: first });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(response(body('ahead', hash(4), hash(5))));
    const changed = await readHistory(
      http,
      'example/fixture',
      [
        { name: 'develop', sha: hash(5) },
        { name: 'codex/work', sha: hash(4) },
      ],
      { previous: first },
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(changed.checks.every((check) => check.targetSha === hash(5))).toBe(true);
    expect(changed.checks.find((check) => check.branchSha === hash(4))?.state).toBe('pending');
  });

  it('reuses local ancestry only for the same two commits and preserves shallow uncertainty', async () => {
    const local = repository();
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body('behind')));
    const http = httpFor(request);
    const first = await readHistory(http, 'example/fixture', branches, { local });
    expect(request).not.toHaveBeenCalled();
    expect(first.checks.find((check) => check.branchSha === hash(2))).toMatchObject({
      state: 'pending',
      source: 'git',
    });
    local.shallow = true;
    await readHistory(http, 'example/fixture', branches, { local });
    expect(request).toHaveBeenCalledTimes(1);
    local.shallow = false;
    local.targets[0].sha = hash(4);
    await readHistory(http, 'example/fixture', branches, { local });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('bounds a thousand-branch refresh, deduplicates aliases, and advances the next batch', async () => {
    const many = [
      { name: 'main', sha: hash(1) },
      ...Array.from({ length: 1000 }, (_, i) => ({
        name: `codex/work-${i}`,
        sha: hash(2 + Math.floor(i / 2)),
      })),
    ];
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const branch = String(url).split('...')[1].split('?')[0];
      return response(body('behind', branch));
    });
    const http = httpFor(request);
    const first = await readHistory(http, 'example/fixture', many);
    expect(request).toHaveBeenCalledTimes(12);
    expect(first.checks).toHaveLength(13);
    const next = await readHistory(http, 'example/fixture', many, { previous: first });
    expect(request).toHaveBeenCalledTimes(24);
    expect(next.checks).toHaveLength(25);
    expect(new Set(request.mock.calls.map(([url]) => String(url))).size).toBe(24);
  });

  it('moves past unavailable pairs and defers retries without blocking unchecked branches', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(body('behind', hash(3))));
    const http = httpFor(request);
    const first = await readHistory(http, 'example/fixture', [
      ...branches,
      { name: 'codex/next', sha: hash(3) },
    ]);
    expect(first.checks.find((check) => check.branchSha === hash(2))?.state).toBe('unknown');
    expect(first.checks.find((check) => check.branchSha === hash(3))?.state).toBe('integrated');
    request.mockResolvedValue(response(body('behind', hash(4))));
    await readHistory(
      http,
      'example/fixture',
      [...branches, { name: 'codex/last', sha: hash(4) }],
      { previous: first },
    );
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(600_000);
    request.mockResolvedValue(response(body('behind')));
    const retried = await readHistory(http, 'example/fixture', branches, { previous: first });
    expect(retried.checks.find((check) => check.branchSha === hash(2))?.state).toBe('integrated');
  });

  it('stops on a rate limit and excludes a response received after disconnect', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, 429));
    const limited = await readHistory(httpFor(request), 'example/fixture', [
      ...branches,
      { name: 'codex/next', sha: hash(3) },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(limited.error).toContain('rate limited');
    let current = true;
    const late = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return response(body('behind'));
    });
    const cancelled = await readHistory(httpFor(late), 'example/fixture', branches, {
      isCurrent: () => current,
    });
    expect(cancelled.checks.some((check) => check.branchSha === hash(2))).toBe(false);
  });
});

describe('independent local and published histories', () => {
  it('does not erase fresh local evidence while a failed GitHub check awaits retry', () => {
    const local = repository();
    local.branches[0].local!.sha = hash(2);
    const remote = source({
      checks: [
        {
          branchSha: hash(2),
          targetSha: hash(1),
          state: 'unknown',
          source: 'github',
          checkedAt: at,
        },
      ],
    });
    expect(enrichRepository(local, [remote]).branches[0].integration.develop).toBe('integrated');
  });
  it('keeps local target and branch tips independent from published targets and tips', async () => {
    const remote = source();
    remote.branches = [
      { name: 'develop', sha: hash(5) },
      { name: 'codex/work', sha: hash(2) },
    ];
    remote.history = await readHistory(
      httpFor(vi.fn<typeof fetch>().mockResolvedValue(response(body('behind', hash(2), hash(5))))),
      remote.repository,
      remote.branches,
    );
    const local = repository();
    const before = structuredClone(local);
    const enriched = enrichRepository(local, [remote]);
    expect(enriched.targets[0].sha).toBe(hash(1));
    expect(enriched.branches[0].integration.develop).toBe('integrated');
    expect(enriched.branches[0].remoteIntegration?.develop).toBe('pending');
    expect(enriched.branches[0].publishedHistory?.targets[0]).toMatchObject({
      sha: hash(5),
      state: 'integrated',
    });
    expect(local).toEqual(before);
    remote.branches[1].sha = hash(6);
    const changed = enrichRepository(local, [remote]).branches[0];
    expect(changed.publishedHistory?.targets[0].state).toBe('unknown');
    expect(changed.remoteIntegration?.develop).toBe('unknown');
  });

  it('discovers a target absent locally and does not borrow a fork comparison', async () => {
    const local = repository();
    local.targets = [];
    local.branches = [];
    const origin = source(
      await readHistory(
        httpFor(vi.fn<typeof fetch>().mockResolvedValue(response(body('behind')))),
        'example/fixture',
        branches,
      ),
    );
    const fork = { ...origin, remoteName: 'fork', repository: 'example/fork', history: undefined };
    const enriched = enrichRepository(local, [origin, fork]);
    expect(enriched.targets[0]).toMatchObject({
      name: 'develop',
      sha: hash(1),
      source: 'github',
      remote: 'origin',
    });
    expect(
      enriched.branches.find(
        (branch) => branch.remote?.fullName === 'refs/remotes/origin/codex/work',
      )?.integration.develop,
    ).toBe('integrated');
    expect(
      enriched.branches.find((branch) => branch.remote?.fullName === 'refs/remotes/fork/codex/work')
        ?.publishedHistory?.targets[0].state,
    ).toBe('unknown');
  });

  it('resurfaces changed published evidence but ignores observation time and unchanged target advances', () => {
    const local = repository();
    const enriched = enrichRepository(local, [source()]);
    const branch = enriched.branches[0];
    const revision = recommendationRevision(enriched, branch);
    branch.publishedHistory!.checkedAt = new Date(Date.now() + 1000).toISOString();
    branch.publishedHistory!.targets[0].sha = hash(5);
    expect(recommendationRevision(enriched, branch)).toBe(revision);
    branch.publishedHistory!.targets[0].state = 'integrated';
    expect(recommendationRevision(enriched, branch)).not.toBe(revision);
  });

  it('includes separate published facts and refuses cleanup when the published target is pending', () => {
    const local = repository();
    local.branches[0].remoteIntegration = { develop: 'integrated' };
    const remote = source();
    remote.history = {
      checks: [
        {
          branchSha: hash(2),
          targetSha: hash(1),
          state: 'integrated',
          source: 'github',
          checkedAt: at,
        },
      ],
    };
    const enriched = enrichRepository(local, [remote]);
    const branch = enriched.branches[0];
    const check = () => {
      const prepared = prepareAnalysis({
        repositories: [{ ...enriched, branches: [branch] }],
        events: [],
        updatedAt: at,
        scanning: false,
      });
      const record = prepared.packet.branches[0];
      expect(record.facts.some((fact) => fact.kind === 'published-history')).toBe(true);
      return validateFindings(
        {
          findings: [
            {
              branchId: record.id,
              category: 'cleanup-candidate',
              title: 'Review completed work',
              explanation: 'The observed commits are integrated.',
              uncertainty: 'Review current work before cleanup.',
              evidenceIds: record.facts.map((fact) => fact.id),
            },
          ],
        },
        prepared,
      );
    };
    expect(check()).toHaveLength(1);
    branch.publishedHistory!.targets[0].state = 'pending';
    expect(check).toThrow('Cleanup');
  });
});
