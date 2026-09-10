import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubError, GitHubHttp } from '../electron/github/http';
import {
  cachedPullSchema,
  limitCachedPulls,
  mergeCachedPulls,
  parsePulls,
  readPulls,
  retainPartialPulls,
} from '../src/github/pulls';
import { missingPullHeads, readPullLookups } from '../src/github/pullLookups';
import { enrichRepository } from '../electron/github/enrich';
import { remoteSnapshotSchema, type RemoteSnapshot } from '../src/github/reader';
import { createDemoSnapshot } from '../src/data/demo';
import {
  collaborationIndex,
  matchingPulls,
  peopleFor,
  pullSourceStale,
  quietDraft,
  reviewRequested,
} from '../src/domain/collaboration';
import type { GitHubPullRequest } from '../src/domain/types';

const hash = 'a'.repeat(40);
const now = Date.parse('2026-09-09T12:00:00Z');
const checkedAt = new Date(now).toISOString();
const sourcePull = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  title: 'Review local sharing',
  state: 'open',
  merged_at: null,
  updated_at: checkedAt,
  user: {
    id: 10,
    login: 'fixture-author',
    type: 'User',
    email: 'PRIVATE_EMAIL',
    avatar_url: 'https://attacker.example/image',
  },
  requested_reviewers: [
    { id: 20, login: 'fixture-reviewer', type: 'User', secret: 'PRIVATE_SECRET' },
  ],
  requested_teams: [{ id: 30, name: 'Platform', slug: 'platform', members_url: 'PRIVATE_MEMBERS' }],
  base: { ref: 'develop' },
  head: { ref: 'feat/sharing', sha: hash, repo: { full_name: 'example/project' } },
  body: 'PRIVATE_BODY',
  html_url: 'https://attacker.example',
  ...overrides,
});
const response = (body: unknown, next = false) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: next ? { link: '<https://api.github.com/next>; rel="next"' } : {},
  });
const http = (request: typeof fetch) => new GitHubHttp(async () => undefined, request);
const normalized = (overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  ...parsePulls([sourcePull()], 'example/project')[0],
  repository: 'example/project',
  observedAt: checkedAt,
  ...overrides,
});
const source = (overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot => ({
  repository: 'example/project',
  remoteName: 'origin',
  branches: [],
  pulls: [parsePulls([sourcePull()], 'example/project')[0]],
  branchesComplete: true,
  openPullsComplete: true,
  pullHistoryComplete: true,
  checkedAt,
  ...overrides,
});
afterEach(() => vi.useRealTimers());

describe('GitHub collaboration metadata', () => {
  it('targets only uncovered non-integration tips that belong to the GitHub source', () => {
    const repo = createDemoSnapshot(now).repositories[0];
    const related = repo.branches[0];
    repo.branches = [
      {
        ...related,
        name: 'feat/local-ahead',
        local: {
          ...related.local!,
          sha: 'b'.repeat(40),
          upstream: 'refs/remotes/origin/feat/local-ahead',
        },
        remote: { ...related.remote!, sha: 'c'.repeat(40), remote: 'origin' },
      },
      {
        ...related,
        name: 'feat/other',
        local: {
          ...related.local!,
          sha: 'd'.repeat(40),
          upstream: 'refs/remotes/upstream/feat/other',
        },
        remote: { ...related.remote!, sha: 'd'.repeat(40), remote: 'upstream' },
      },
    ];
    expect(
      missingPullHeads(
        [
          { name: 'develop', sha: 'e'.repeat(40) },
          { name: 'feat/covered', sha: hash },
          { name: 'feat/remote', sha: 'c'.repeat(40) },
        ],
        [parsePulls([sourcePull()], 'example/project')[0]],
        'origin',
        repo,
      ),
    ).toEqual(['c'.repeat(40), 'b'.repeat(40)]);
  });

  it('does not send a verified nonstandard default through exact PR lookup', () => {
    const repo = createDemoSnapshot().repositories[0];
    repo.targets = [
      {
        name: 'trunk',
        sha: 'e'.repeat(40),
        source: 'local',
        remote: 'origin',
        role: 'default',
      },
    ];
    expect(
      missingPullHeads(
        [
          { name: 'trunk', sha: 'e'.repeat(40) },
          { name: 'feat/work', sha: 'f'.repeat(40) },
        ],
        [],
        'origin',
        repo,
      ),
    ).not.toContain('e'.repeat(40));
  });

  it('finds old PRs by exact commit, rejects moved heads, and resumes pagination', async () => {
    const exact = 'b'.repeat(40),
      moved = 'c'.repeat(40),
      request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response(
            [
              sourcePull({
                number: 9,
                head: { ref: 'feat/old', sha: exact, repo: { full_name: 'example/project' } },
              }),
              sourcePull({
                number: 10,
                head: { ref: 'feat/moved', sha: moved, repo: { full_name: 'example/project' } },
              }),
            ],
            true,
          ),
        )
        .mockResolvedValueOnce(
          response([
            sourcePull({
              number: 11,
              head: { ref: 'feat/old', sha: exact, repo: { full_name: 'example/project' } },
            }),
          ]),
        );
    const first = await readPullLookups(http(request), 'example/project', [exact], {
      budget: { remaining: 1, milliseconds: 10_000 },
    });
    expect(String(request.mock.calls[0][0])).toContain(
      `/commits/${exact}/pulls?per_page=100&page=1`,
    );
    expect(first.pulls.map((pull) => pull.number)).toEqual([9]);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE|attacker|email|avatar/);
    expect(first.lookups[0]).toMatchObject({ complete: false, found: true, nextPage: 2 });
    const second = await readPullLookups(http(request), 'example/project', [exact], {
      previous: first.lookups,
      budget: { remaining: 1, milliseconds: 10_000 },
    });
    expect(String(request.mock.calls[1][0])).toContain('page=2');
    expect(second.pulls.map((pull) => pull.number)).toEqual([11]);
    expect(second.lookups[0]).toMatchObject({ complete: true, found: true });
    expect(second.lookups[0].nextPage).toBeUndefined();
  });

  it('rotates exact lookups, caches empty coverage, and retries it after ten minutes', async () => {
    vi.useFakeTimers();
    const firstSha = 'b'.repeat(40),
      secondSha = 'c'.repeat(40),
      get = vi.fn().mockResolvedValue({ body: [], hasNext: false }),
      reader = { get };
    const first = await readPullLookups(reader, 'example/project', [firstSha, secondSha], {
      budget: { remaining: 1, milliseconds: 10_000 },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(first.lookups).toHaveLength(1);
    const second = await readPullLookups(reader, 'example/project', [firstSha, secondSha], {
      previous: first.lookups,
      budget: { remaining: 1, milliseconds: 10_000 },
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(second.lookups).toHaveLength(2);
    await readPullLookups(reader, 'example/project', [firstSha, secondSha], {
      previous: second.lookups,
      budget: { remaining: 2, milliseconds: 10_000 },
    });
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    await readPullLookups(reader, 'example/project', [firstSha, secondSha], {
      previous: second.lookups,
      budget: { remaining: 2, milliseconds: 10_000 },
    });
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('continues after an unavailable commit and rejects a result received after disconnect', async () => {
    const firstSha = 'b'.repeat(40),
      secondSha = 'c'.repeat(40),
      get = vi
        .fn()
        .mockRejectedValueOnce(new GitHubError('Commit unavailable.', 422))
        .mockResolvedValueOnce({ body: [], hasNext: false });
    const result = await readPullLookups({ get }, 'example/project', [firstSha, secondSha], {
      budget: { remaining: 2, milliseconds: 10_000 },
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.lookups.find((item) => item.headSha === firstSha)?.error).toBe(
      'Commit unavailable.',
    );
    expect(result.lookups.find((item) => item.headSha === secondSha)?.complete).toBe(true);

    let current = true;
    await expect(
      readPullLookups(
        {
          get: async () => {
            current = false;
            return { body: [], hasNext: false };
          },
        },
        'example/project',
        [firstSha],
        { budget: { remaining: 1, milliseconds: 10_000 }, isCurrent: () => current },
      ),
    ).rejects.toThrow('cancelled');
  });

  it('keeps every open PR and exact-tip result inside the source cache bound', () => {
    const open = Array.from({ length: 5000 }, (_, index) =>
        normalized({
          number: index + 1,
          headName: `feat/open-${index}`,
          headSha: index.toString(16).padStart(40, '0'),
        }),
      ),
      closed = Array.from({ length: 300 }, (_, index) =>
        normalized({
          number: 6000 + index,
          state: 'closed',
          headName: `feat/closed-${index}`,
          headSha: (6000 + index).toString(16).padStart(40, '0'),
          updatedAt: new Date(now - index * 1000).toISOString(),
        }),
      ),
      exact = normalized({
        number: 9000,
        state: 'merged',
        headName: 'feat/exact-old-pr',
        headSha: 'f'.repeat(40),
        updatedAt: '2020-01-01T00:00:00.000Z',
      });
    const limited = limitCachedPulls(mergeCachedPulls([...open, ...closed], [exact]), [exact]);
    expect(limited).toHaveLength(5300);
    expect(limited.filter((pull) => pull.state === 'open')).toHaveLength(5000);
    expect(limited.some((pull) => pull.number === exact.number)).toBe(true);
    expect(limited.some((pull) => pull.number === 6299)).toBe(false);
  });

  it('preserves older PR evidence on partial listings with its original observation time, then replaces it when observed', () => {
    const previous = source({ checkedAt: '2026-09-08T12:00:00Z' });
    const partial = source({ openPullsComplete: false, pullHistoryComplete: false, pulls: [] });
    const saved = retainPartialPulls(partial, previous);
    expect(saved.pulls[0]).toMatchObject({ retained: true, observedAt: previous.checkedAt });
    const repo = createDemoSnapshot(now).repositories[0];
    const retained = enrichRepository(repo, [saved]).github!.pulls![0];
    expect(pullSourceStale(retained, now)).toBe(true);
    const fresh = retainPartialPulls(source(), saved);
    expect(fresh.pulls[0]).toMatchObject({ retained: false, observedAt: checkedAt });
    expect(retainPartialPulls(source({ pulls: [] }), saved).pulls).toHaveLength(0);
  });

  it('retains authors, review requests and deleted-head PRs without bodies, private actor fields or arbitrary links', () => {
    const pull = parsePulls(
      [sourcePull({ head: { ref: 'feat/sharing', sha: hash, repo: null } })],
      'example/project',
    )[0];
    expect(pull).toMatchObject({
      headRepository: null,
      author: { id: '10', login: 'fixture-author', kind: 'user' },
      requestedReviewers: [{ id: '20', kind: 'user' }],
      requestedTeams: [{ id: '30', name: 'Platform' }],
      url: 'https://github.com/example/project/pull/1',
    });
    expect(JSON.stringify(pull)).not.toMatch(/PRIVATE|attacker|email|avatar|members_url/);
    expect(cachedPullSchema.parse(pull)).toEqual(pull);
    expect(
      parsePulls(
        [sourcePull({ user: null, requested_reviewers: undefined, requested_teams: undefined })],
        'example/project',
      )[0].author,
    ).toBeUndefined();
    expect(
      parsePulls(
        [sourcePull({ user: { id: 40, login: 'fixture-bot', type: 'Bot' } })],
        'example/project',
      )[0].author?.kind,
    ).toBe('bot');
  });
  it('loads older open work independently of closed history and observes a PR closing between pages', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('state') === 'open')
        return url.searchParams.get('page') === '1'
          ? response([sourcePull()], true)
          : response([sourcePull({ number: 2, updated_at: '2020-01-01T00:00:00Z', draft: true })]);
      return response([sourcePull({ state: 'closed', merged_at: checkedAt })]);
    });
    const index = await readPulls(http(request), 'example/project');
    expect(index.openPullsComplete).toBe(true);
    expect(index.pullHistoryComplete).toBe(true);
    expect(index.pulls.find((pull) => pull.number === 2)?.draft).toBe(true);
    expect(index.pulls.find((pull) => pull.number === 1)?.state).toBe('merged');
    expect(request.mock.calls).toHaveLength(3);
  });
  it('labels capped open and closed listings as incomplete, with no unbounded pagination', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page'));
      return response(
        [sourcePull({ number: page + (url.searchParams.get('state') === 'closed' ? 100 : 0) })],
        true,
      );
    });
    const index = await readPulls(http(request), 'example/project');
    expect(index.openPullsComplete).toBe(false);
    expect(index.pullHistoryComplete).toBe(false);
    expect(request).toHaveBeenCalledTimes(53);
  });
  it('bounds elapsed time and rejects results after disconnect', async () => {
    vi.useFakeTimers();
    const slow = vi.fn<typeof fetch>().mockImplementation(async () => {
      vi.advanceTimersByTime(31_000);
      return response([sourcePull()], true);
    });
    expect((await readPulls(http(slow), 'example/project')).openPullsComplete).toBe(false);
    expect(slow).toHaveBeenCalledTimes(1);
    let current = true;
    const cancelled = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return response([sourcePull()]);
    });
    await expect(readPulls(http(cancelled), 'example/project', () => current)).rejects.toThrow(
      'cancelled',
    );
  });
  it('accepts old cached PRs without inventing authors or complete open coverage', () => {
    const old = source();
    delete old.openPullsComplete;
    delete old.pulls[0].author;
    delete old.pulls[0].requestedReviewers;
    delete old.pulls[0].requestedTeams;
    const parsed = remoteSnapshotSchema.parse(old);
    expect(parsed.pulls[0].author).toBeUndefined();
    expect(parsed.openPullsComplete).toBeUndefined();
  });
  it('retains exact merged-PR evidence after remote deletion without attaching changed commits or deleted forks by name', () => {
    const repo = createDemoSnapshot(now).repositories[0];
    const branch = repo.branches[0];
    repo.branches = [
      {
        ...branch,
        name: 'feat/sharing',
        local: { ...branch.local!, sha: hash },
        remote: { ...branch.remote!, name: 'feat/sharing', sha: hash, remote: 'origin' },
      },
    ];
    const merged = source({
      pulls: [
        parsePulls([sourcePull({ state: 'closed', merged_at: checkedAt })], 'example/project')[0],
      ],
    });
    let enriched = enrichRepository(repo, [merged]);
    expect(enriched.branches[0].remote?.presence).toBe('missing');
    expect(enriched.branches[0].pullRequest?.state).toBe('merged');
    expect(enriched.github?.pulls).toHaveLength(1);
    repo.branches[0].local!.sha = 'b'.repeat(40);
    enriched = enrichRepository(repo, [merged]);
    expect(enriched.branches[0].pullRequest).toBeUndefined();
    const deleted = source({
      pulls: [
        parsePulls(
          [sourcePull({ head: { ref: 'feat/sharing', sha: hash, repo: null } })],
          'example/project',
        )[0],
      ],
    });
    expect(enrichRepository(repo, [deleted]).github?.pulls).toHaveLength(1);
    expect(enrichRepository(repo, [deleted]).branches[0].pullRequest).toBeUndefined();
    expect(enrichRepository(repo, [source({ error: 'offline' })]).github?.openPullsComplete).toBe(
      false,
    );
  });

  it('attaches exact-tip PR lookup coverage only to the branch commit it describes', () => {
    const repo = createDemoSnapshot(now).repositories[0],
      branch = repo.branches[0];
    repo.branches = [
      {
        ...branch,
        name: 'feat/history',
        local: {
          ...branch.local!,
          sha: hash,
          upstream: 'refs/remotes/origin/feat/history',
        },
        remote: { ...branch.remote!, name: 'feat/history', sha: hash, remote: 'origin' },
      },
    ];
    const lookup = source({
      pulls: [],
      pullLookups: [
        { headSha: hash, checkedAt, complete: true, found: false, retryAt: now + 60_000 },
      ],
    });
    expect(enrichRepository(repo, [lookup]).branches[0].pullLookup).toMatchObject({
      headSha: hash,
      complete: true,
      found: false,
    });
    repo.branches[0].local!.sha = 'b'.repeat(40);
    expect(enrichRepository(repo, [lookup]).branches[0].pullLookup).toBeUndefined();
  });
});

describe('people and PR selectors', () => {
  it('indexes and filters a thousand PRs with stable identities and bounded match results', () => {
    const repo = createDemoSnapshot(now).repositories[0];
    const sample = repo.branches[0];
    const pulls = Array.from({ length: 1000 }, (_, index) =>
      normalized({
        number: index + 1,
        author: { id: String(100 + (index % 50)), login: 'fixture-' + (index % 50), kind: 'user' },
        url: 'https://github.com/example/project/pull/' + (index + 1),
        headName: 'feat/work-' + index,
      }),
    );
    repo.github!.pulls = pulls;
    repo.branches = pulls.map((pull, index) => ({
      ...sample,
      id: 'branch-' + index,
      pullRequest: pull,
    }));
    const work = collaborationIndex([repo]);
    expect(work).toHaveLength(1000);
    expect(work.every((item) => item.links.length === 1)).toBe(true);
    expect(
      matchingPulls(
        work,
        { query: '', person: '100', project: 'all', tool: 'all', filter: 'open' },
        now,
      ),
    ).toHaveLength(20);
  });

  it('deduplicates GitHub PRs across local clones while preserving branch links and the latest observed evidence', () => {
    const first = createDemoSnapshot(now).repositories[0];
    const second = {
      ...first,
      id: 'another-clone',
      name: 'another-name',
      github: {
        ...first.github!,
        pulls: first.github!.pulls!.map((pull) => ({
          ...pull,
          sourceError: 'offline',
          observedAt: new Date(now - 120_000).toISOString(),
        })),
      },
    };
    const work = collaborationIndex([first, second]);
    expect(work).toHaveLength(first.github!.pulls!.length);
    const linked = work.find((item) => item.links.length)!;
    expect(linked.links).toHaveLength(2);
    expect(linked.pull.sourceError).toBeUndefined();
    expect(linked.projects).toEqual([first.name, second.name]);
    const newer = {
      ...second,
      github: {
        ...second.github!,
        pulls: second.github!.pulls!.map((pull) => ({
          ...pull,
          state: 'closed' as const,
          observedAt: new Date(now).toISOString(),
        })),
      },
    };
    expect(collaborationIndex([first, newer]).every((item) => item.pull.state === 'closed')).toBe(
      true,
    );
  });
  it('separates author and review roles, identifies bots, and never expands requested teams into people', () => {
    const repo = createDemoSnapshot(now).repositories[0];
    repo.github!.pulls = [
      normalized(),
      normalized({
        number: 2,
        author: undefined,
        requestedReviewers: [{ id: '40', login: 'fixture-bot', kind: 'bot' }],
      }),
    ];
    const people = peopleFor(collaborationIndex([repo]));
    expect(people.find((person) => person.id === '10')).toMatchObject({
      authored: 1,
      requested: 0,
    });
    expect(people.find((person) => person.id === '20')).toMatchObject({
      authored: 0,
      requested: 1,
    });
    expect(people.find((person) => person.id === '40')?.actor?.kind).toBe('bot');
    expect(people.find((person) => person.id === 'unknown-author')?.authored).toBe(1);
    expect(people.some((person) => person.id === '30')).toBe(false);
  });
  it('filters by person, project, recorded tool/model and PR state independently', () => {
    const work = collaborationIndex(createDemoSnapshot(now).repositories);
    const options = {
      query: '',
      person: null,
      project: 'all',
      tool: 'all',
      filter: 'open' as const,
    };
    expect(matchingPulls(work, { ...options, query: 'grok' }, now).length).toBeGreaterThan(0);
    expect(
      matchingPulls(work, { ...options, tool: 'cursor', project: 'example/atlas-api' }, now).every(
        (item) => item.pull.repository === 'example/atlas-api',
      ),
    ).toBe(true);
    const reviewer = work.find((item) => item.pull.requestedReviewers?.length)!.pull
      .requestedReviewers![0].id;
    expect(
      matchingPulls(work, { ...options, person: reviewer }, now).every(
        ({ pull }) =>
          pull.author?.id === reviewer ||
          pull.requestedReviewers?.some((actor) => actor.id === reviewer),
      ),
    ).toBe(true);
    expect(matchingPulls(work, { ...options, filter: 'quiet-drafts' }, now)).toHaveLength(6);
    expect(matchingPulls(work, { ...options, filter: 'history' }, now)).toHaveLength(9);
  });
  it('distinguishes stale observations and invalid dates from quiet-draft evidence', () => {
    expect(quietDraft(normalized({ draft: true, updatedAt: 'invalid' }), now)).toBe(false);
    expect(
      quietDraft(
        normalized({ draft: true, updatedAt: new Date(now - 14 * 86_400_000).toISOString() }),
        now,
      ),
    ).toBe(true);
    expect(
      quietDraft(normalized({ draft: true, state: 'merged', updatedAt: '2020-01-01' }), now),
    ).toBe(false);
    expect(reviewRequested(normalized({ state: 'closed' }))).toBe(false);
    expect(pullSourceStale(normalized(), now)).toBe(false);
    expect(
      pullSourceStale(normalized({ observedAt: new Date(now - 11 * 60_000).toISOString() }), now),
    ).toBe(true);
    expect(pullSourceStale(normalized({ sourceError: 'offline' }), now)).toBe(true);
  });
});
