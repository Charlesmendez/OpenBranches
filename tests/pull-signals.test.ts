import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubError } from '../electron/github/http';
import { limitSignalCache, readPullSignals } from '../electron/github/signals';
import {
  parseChecks,
  parseReviews,
  parseStatuses,
  pullSignalsSchema,
} from '../electron/github/signalsSchema';
import type { CachedPull } from '../electron/github/pulls';
import { remoteSnapshotSchema } from '../electron/github/reader';
import { checksSummary, hasFailedChecks, type PullSignals } from '../src/domain/pullSignals';
import { collaborationIndex, matchingPulls, mergePullEvidence } from '../src/domain/collaboration';
import { createDemoSnapshot } from '../src/data/demo';

const hash = 'a'.repeat(40);
const otherHash = 'b'.repeat(40);
const time = Date.parse('2026-09-09T14:00:00Z');
const at = new Date(time).toISOString();
const actor = { id: 42, login: 'fixture-reviewer', type: 'User', email: 'private@example.test' };
const pull = (number = 1, headSha = hash): CachedPull => ({
  number,
  headSha,
  state: 'open',
  title: 'Fictional work',
  url: `https://github.com/example/repo/pull/${number}`,
  base: 'develop',
  updatedAt: at,
  headName: 'feat/work',
  headRepository: 'example/repo',
});
const run = (id = 1, conclusion = 'success') => ({
  id,
  name: `Check ${id}`,
  head_sha: hash,
  status: 'completed',
  conclusion,
  output: { text: 'PRIVATE CHECK LOG' },
  details_url: 'https://untrusted.example/log',
});
const review = (id = 1, state = 'APPROVED') => ({
  id,
  user: actor,
  state,
  commit_id: hash,
  submitted_at: at,
  body: 'PRIVATE REVIEW BODY',
  html_url: 'https://untrusted.example/review',
});
const budget = (remaining = 6) => ({ remaining, milliseconds: 20_000 });
const observation = (): PullSignals => ({
  headSha: hash,
  attemptedAt: at,
  checks: {
    observedAt: at,
    complete: true,
    total: 1,
    counts: { failed: 0, pending: 0, passed: 1, other: 0 },
    items: [{ id: '1', name: 'Tests', kind: 'check', state: 'passed', result: 'success' }],
  },
  reviews: {
    observedAt: at,
    complete: true,
    total: 1,
    items: [
      {
        id: '1',
        actor: { id: '42', login: 'fixture-reviewer', kind: 'user' },
        state: 'APPROVED',
        commitSha: hash,
        submittedAt: at,
      },
    ],
  },
});
const http = () => ({
  get: vi.fn(async (path: string) => ({
    body: path.includes('/check-runs')
      ? { total_count: 1, check_runs: [run()] }
      : path.includes('/reviews')
        ? [review()]
        : { sha: hash, total_count: 0, statuses: [] },
    hasNext: false,
  })),
});
afterEach(() => vi.useRealTimers());

describe('PR evidence whitelist and meaning', () => {
  it('keeps typed observations while discarding bodies, logs, profiles, and external links', async () => {
    vi.useFakeTimers().setSystemTime(time);
    const result = await readPullSignals(http(), 'example/repo', [pull()], [], budget());
    const signals = result[0].signals!;
    expect(pullSignalsSchema.safeParse(signals).success).toBe(true);
    expect(signals.checks).toMatchObject({ complete: true, total: 1, counts: { passed: 1 } });
    expect(signals.reviews?.items[0]).toMatchObject({
      actor: { id: '42', kind: 'user' },
      state: 'APPROVED',
      commitSha: hash,
    });
    const serialized = JSON.stringify(signals);
    for (const secret of [
      'PRIVATE',
      'private@example',
      'untrusted.example',
      'html_url',
      'output',
      'body',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('requires the exact commit for both check runs and legacy statuses', () => {
    expect(() => parseChecks({ total_count: 1, check_runs: [run()] }, otherHash)).toThrow('commit');
    expect(() => parseStatuses({ sha: otherHash, total_count: 0, statuses: [] }, hash)).toThrow(
      'commit',
    );
    expect(
      parseStatuses(
        {
          sha: hash,
          total_count: 1,
          statuses: [{ id: 2, context: 'Legacy CI', state: 'failure', description: 'PRIVATE' }],
        },
        hash,
      ).items[0],
    ).toEqual({ id: '2', name: 'Legacy CI', kind: 'status', state: 'failed', result: 'failure' });
  });

  it('does not call neutral, skipped, unknown conclusions, or unknown execution states passing', () => {
    for (const conclusion of ['neutral', 'skipped', 'stale', 'new-provider-state'])
      expect(
        parseChecks({ total_count: 1, check_runs: [run(1, conclusion)] }, hash).items[0].state,
      ).toBe('other');
    expect(
      parseChecks({ total_count: 1, check_runs: [{ ...run(), status: 'new-status' }] }, hash)
        .items[0].state,
    ).toBe('other');
    for (const conclusion of [
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'startup_failure',
    ])
      expect(
        parseChecks({ total_count: 1, check_runs: [run(1, conclusion)] }, hash).items[0].state,
      ).toBe('failed');
  });

  it('preserves dismissal and reviewed commit while excluding unsubmitted review drafts', () => {
    const records = parseReviews([
      review(),
      { ...review(2, 'DISMISSED'), commit_id: otherHash },
      { ...review(3, 'PENDING'), submitted_at: null },
      { ...review(4, 'COMMENTED'), user: null, commit_id: null },
    ]);
    expect(records).toHaveLength(3);
    expect(records[1]).toMatchObject({ state: 'DISMISSED', commitSha: otherHash });
    expect(records[2]).toMatchObject({ state: 'COMMENTED', commitSha: null });
    expect(records[2].actor).toBeUndefined();
  });

  it('never turns missing, incomplete, outdated, or earlier-head results into a passing summary', () => {
    const signals = observation();
    expect(checksSummary(hash, undefined, time).state).toBe('unknown');
    expect(checksSummary(hash, signals, time).state).toBe('passed');
    expect(checksSummary(otherHash, signals, time).state).toBe('unknown');
    expect(checksSummary(hash, signals, time + 601_000).state).toBe('unknown');
    signals.checks!.complete = false;
    expect(checksSummary(hash, signals, time).state).toBe('unknown');
    signals.checks!.complete = true;
    signals.checks!.total = 0;
    signals.checks!.counts.passed = 0;
    expect(checksSummary(hash, signals, time).label).toBe('No checks reported');
    signals.checks!.observedAt = 'not-a-date';
    expect(checksSummary(hash, signals, time).state).toBe('unknown');
  });

  it('uses partial positive failure evidence but excludes stale sources and historical PRs from alerts', () => {
    const signals = observation();
    signals.checks!.counts = { failed: 1, pending: 0, passed: 0, other: 0 };
    signals.checks!.complete = false;
    const value = { ...pull(), signals };
    expect(hasFailedChecks(value, time)).toBe(true);
    expect(hasFailedChecks({ ...value, sourceError: 'Source unavailable' }, time)).toBe(false);
    expect(hasFailedChecks({ ...value, retained: true }, time)).toBe(false);
    expect(hasFailedChecks({ ...value, state: 'merged' }, time)).toBe(false);
    expect(hasFailedChecks(value, time + 601_000)).toBe(false);
  });
});

describe('bounded background PR reads', () => {
  it('shares the request budget across PRs and does not repeatedly read recent observations', async () => {
    vi.useFakeTimers().setSystemTime(time);
    const client = http();
    const pulls = Array.from({ length: 40 }, (_, i) => pull(i + 1));
    const first = await readPullSignals(client, 'example/repo', pulls, [], budget());
    expect(client.get).toHaveBeenCalledTimes(6);
    expect(first.filter((item) => item.signals)).toHaveLength(2);
    const next = await readPullSignals(client, 'example/repo', pulls, first, budget(3));
    expect(client.get).toHaveBeenCalledTimes(9);
    expect(next[2].signals?.checks?.total).toBe(1);
    expect(next[0].signals).toEqual(first[0].signals);
    expect(client.get.mock.calls[8][0]).toContain('/pulls/3/reviews');
  });

  it('invalidates old-head evidence immediately even when no request budget remains', async () => {
    const previous = [{ ...pull(), signals: observation() }];
    const client = http();
    const next = await readPullSignals(
      client,
      'example/repo',
      [pull(1, otherHash)],
      previous,
      budget(0),
    );
    expect(next[0].signals).toBeUndefined();
    expect(client.get).not.toHaveBeenCalled();
    expect(previous[0].signals.checks?.total).toBe(1);
  });

  it('caps endpoint pagination and compact detail retention while marking missing pages', async () => {
    vi.useFakeTimers().setSystemTime(time);
    const client = {
      get: vi.fn(async (path: string) => {
        const second = path.includes('page=2');
        const start = second ? 101 : 1;
        return {
          body: path.includes('/check-runs')
            ? {
                total_count: 500,
                check_runs: Array.from({ length: 100 }, (_, i) =>
                  run(start + i, i === 99 ? 'failure' : 'success'),
                ),
              }
            : path.includes('/reviews')
              ? Array.from({ length: 100 }, (_, i) => review(start + i))
              : { sha: hash, total_count: 0, statuses: [] },
          hasNext: !path.includes('/status'),
        };
      }),
    };
    const result = (await readPullSignals(client, 'example/repo', [pull()], [], budget()))[0]
      .signals!;
    expect(client.get).toHaveBeenCalledTimes(5);
    expect(result.checks).toMatchObject({
      complete: false,
      total: 200,
      counts: { failed: 2, passed: 198 },
    });
    expect(result.checks!.items).toHaveLength(30);
    expect(result.checks!.items[0].state).toBe('failed');
    expect(result.reviews).toMatchObject({ complete: false, total: 200 });
    expect(result.reviews!.items).toHaveLength(30);
    expect(result.reviews!.items[0].id).toBe('200');
    expect(pullSignalsSchema.safeParse(result).success).toBe(true);
  });

  it('requires the reported total as well as the final page before claiming complete checks', async () => {
    const client = http();
    client.get.mockResolvedValueOnce({
      body: { total_count: 2, check_runs: [run()] },
      hasNext: false,
    });
    const result = (await readPullSignals(client, 'example/repo', [pull()], [], budget()))[0]
      .signals!;
    expect(result.checks?.complete).toBe(false);
    expect(checksSummary(hash, result).state).toBe('unknown');
  });

  it('retains original timestamps on endpoint failure and continues other independent evidence', async () => {
    vi.useFakeTimers().setSystemTime(time + 601_000);
    const client = http();
    client.get.mockRejectedValueOnce(new GitHubError('Checks access unavailable.', 403));
    client.get.mockRejectedValueOnce(new GitHubError('Status access unavailable.', 403));
    const signals = (
      await readPullSignals(
        client,
        'example/repo',
        [pull()],
        [{ ...pull(), signals: observation() }],
        budget(),
      )
    )[0].signals!;
    expect(signals.checks).toMatchObject({
      observedAt: at,
      error: 'Checks access unavailable.',
      total: 1,
    });
    expect(signals.attemptedAt).not.toBe(at);
    expect(signals.reviews?.observedAt).not.toBe(at);
    expect(checksSummary(hash, signals).state).toBe('unknown');
  });

  it('does not fill missing current checks from cached successes when only statuses refresh', async () => {
    vi.useFakeTimers().setSystemTime(time + 601_000);
    const client = http();
    client.get.mockRejectedValueOnce(new GitHubError('Checks unavailable.', 404));
    const result = (
      await readPullSignals(
        client,
        'example/repo',
        [pull()],
        [{ ...pull(), signals: observation() }],
        budget(),
      )
    )[0].signals!;
    expect(result.checks).toMatchObject({
      complete: false,
      total: 0,
      counts: { passed: 0 },
      error: 'Checks unavailable.',
    });
  });

  it('stops after a cancellation during the current request and publishes no partial result', async () => {
    let current = true;
    const client = http();
    client.get.mockImplementationOnce(async () => {
      current = false;
      return { body: { total_count: 1, check_runs: [run()] }, hasNext: false };
    });
    await expect(
      readPullSignals(client, 'example/repo', [pull()], [], budget(), () => current),
    ).rejects.toThrow('cancelled');
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('stops starting requests after the elapsed-time budget and labels the partial observation', async () => {
    vi.useFakeTimers().setSystemTime(time);
    const client = http();
    client.get.mockImplementationOnce(async () => {
      vi.setSystemTime(time + 21_000);
      return { body: { total_count: 1, check_runs: [run()] }, hasNext: false };
    });
    const result = (await readPullSignals(client, 'example/repo', [pull()], [], budget()))[0]
      .signals!;
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(result.checks).toMatchObject({ complete: false, observedAt: at });
    expect(result.reviews).toBeUndefined();
    expect(checksSummary(hash, result).state).toBe('unknown');
  });

  it('bounds persisted details without discarding queue positions or touching the input', () => {
    const values = Array.from({ length: 150 }, (_, i) => ({
      ...pull(i + 1),
      signals: { ...observation(), attemptedAt: new Date(time + i * 1000).toISOString() },
    }));
    const compact = limitSignalCache(values);
    expect(compact.filter((item) => item.signals?.checks)).toHaveLength(100);
    expect(compact[0].signals).toEqual({ headSha: hash, attemptedAt: at });
    expect(values[0].signals.checks?.total).toBe(1);
    const source = remoteSnapshotSchema.safeParse({
      repository: 'example/repo',
      remoteName: 'origin',
      branches: [],
      pulls: compact,
      checkedAt: at,
      branchesComplete: true,
      pullHistoryComplete: true,
    });
    expect(source.success).toBe(true);
  });

  it('does not issue new signal reads for historical PRs or expose an unbounded endpoint path', async () => {
    const client = http();
    await readPullSignals(
      client,
      'example/repo',
      [{ ...pull(), state: 'merged' }, pull(2, '../secret')],
      [],
      budget(),
    );
    expect(client.get).not.toHaveBeenCalled();
  });
});

describe('collaboration check filtering', () => {
  it('keeps exact-head signals when another clone has newer PR metadata but no signal read', () => {
    const record = createDemoSnapshot().repositories[0].github!.pulls![0];
    const older = { ...record, headSha: hash, observedAt: at, signals: observation() };
    const newer = {
      ...older,
      observedAt: new Date(time + 60_000).toISOString(),
      title: 'New PR title',
      signals: undefined,
    };
    expect(mergePullEvidence(newer, older)).toMatchObject({
      title: 'New PR title',
      signals: observation(),
    });
    expect(mergePullEvidence({ ...newer, headSha: otherHash }, older).signals).toBeUndefined();
    const failed = mergePullEvidence(newer, { ...older, sourceError: 'Source unavailable.' });
    expect(failed.signals?.checks?.error).toBe('Source unavailable.');
    expect(checksSummary(hash, failed.signals, time).state).toBe('unknown');
  });

  it('rejects inconsistent cached check counts instead of inventing a passing result', () => {
    const signals = observation();
    signals.checks!.items[0].state = 'failed';
    expect(pullSignalsSchema.safeParse(signals).success).toBe(false);
  });

  it('combines project/person filters and excludes stale, closed, and changed-head evidence', () => {
    const snapshot = createDemoSnapshot();
    const repository = snapshot.repositories[0];
    const first = repository.github!.pulls![0];
    const signals = observation();
    signals.checks!.counts = { failed: 1, pending: 0, passed: 0, other: 0 };
    repository.github!.pulls = [
      {
        ...first,
        number: 1,
        state: 'open',
        headSha: hash,
        signals,
        observedAt: at,
        retained: false,
        sourceError: undefined,
      },
      { ...first, number: 2, state: 'open', headSha: otherHash, signals, observedAt: at },
      { ...first, number: 3, state: 'merged', headSha: hash, signals, observedAt: at },
      {
        ...first,
        number: 4,
        state: 'open',
        headSha: hash,
        signals,
        observedAt: new Date(time - 700_000).toISOString(),
      },
    ];
    const work = collaborationIndex([repository]);
    const options = {
      query: '',
      person: first.author!.id,
      project: first.repository.toLowerCase(),
      tool: 'all',
      filter: 'failed-checks' as const,
    };
    expect(matchingPulls(work, options, time).map((item) => item.pull.number)).toEqual([1]);
    expect(matchingPulls(work, { ...options, person: 'unrelated-person' }, time)).toEqual([]);
  });
});
