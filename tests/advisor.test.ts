import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStore } from '../electron/services/store';
import { AdvisorBudget } from '../electron/advisor/budget';
import { ADVISOR_INSTRUCTIONS, ADVISOR_POLICY as policy } from '../electron/advisor/policy';
import { advisorBranchId, prepareAnalysis, tokenCount } from '../electron/advisor/packet';
import { validateFindings } from '../electron/advisor/findings';
import {
  accountAllowsAnalysis,
  parseAccountLimits,
  readCodexAccount,
} from '../electron/codex/account';
import { createDemoSnapshot } from '../src/data/demo';
import type { CodexAccount } from '../src/domain/types';

const now = Date.now();
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const usage = (usedPercent = 10) => ({
  primary: { usedPercent, resetsAt: Math.floor(now / 1000) + 18000, windowDurationMins: 300 },
  secondary: null,
});
const account = (): CodexAccount => ({
  auth: 'chatgpt',
  checkedAt: new Date(now).toISOString(),
  limits: parseAccountLimits({ rateLimits: usage() }),
});

async function ledger() {
  const directory = await mkdtemp(join(tmpdir(), 'openbranches-advisor-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new AppStore(directory);
  cleanup.push(() => store.close());
  return { directory, store, budget: new AdvisorBudget(store) };
}

describe('Codex account limits', () => {
  it('prefers per-bucket usage and preserves unknown data instead of reporting zero use', () => {
    const parsed = parseAccountLimits({
      rateLimits: usage(0),
      rateLimitsByLimitId: {
        codex: usage(80),
        other: {},
        malformed: { primary: { usedPercent: 'unknown' } },
      },
    });
    expect(parsed[0].primary?.usedPercent).toBe(80);
    expect(parsed[1]).toMatchObject({ available: false });
    expect(parsed[2]).toMatchObject({ available: false });
    expect(parseAccountLimits({ rateLimitsByLimitId: {}, rateLimits: usage(0) })).toEqual([]);
    expect(accountAllowsAnalysis({ ...account(), limits: parsed }, now)).toBe(true);
  });

  it('does not mistake account credits or an elapsed reset time for available usage', () => {
    const reached = {
      ...usage(2),
      rateLimitReachedType: 'workspace_member_usage_limit_reached',
      credits: { hasCredits: true, unlimited: true },
    };
    expect(
      accountAllowsAnalysis(
        { ...account(), limits: parseAccountLimits({ rateLimits: reached }) },
        now,
      ),
    ).toBe(false);
    expect(
      accountAllowsAnalysis(
        { ...account(), limits: parseAccountLimits({ rateLimits: usage(100) }) },
        now,
      ),
    ).toBe(false);
    expect(
      accountAllowsAnalysis(
        {
          ...account(),
          limits: parseAccountLimits({
            rateLimits: {
              ...usage(1),
              individualLimit: { remainingPercent: 0, resetsAt: Math.floor(now / 1000) + 300 },
            },
          }),
        },
        now,
      ),
    ).toBe(false);
    const reset = { primary: { usedPercent: 0, resetsAt: Math.floor(now / 1000) - 1 } };
    expect(
      accountAllowsAnalysis(
        { ...account(), limits: parseAccountLimits({ rateLimits: reset }) },
        now,
      ),
    ).toBe(false);
    expect(accountAllowsAnalysis(account(), now + policy.maxAccountAgeMs + 1)).toBe(false);
    expect(accountAllowsAnalysis(account(), now - 1)).toBe(false);
    expect(accountAllowsAnalysis({ ...account(), auth: 'other' }, now)).toBe(false);
    expect(accountAllowsAnalysis({ ...account(), limits: [] }, now)).toBe(false);
  });

  it('reads existing sign-in and usage without exposing identity, credit IDs, or tokens', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        account: {
          type: 'chatgpt',
          email: 'private@example.invalid',
          planType: 'pro',
          accessToken: 'private-token',
        },
      })
      .mockResolvedValueOnce({
        rateLimits: usage(),
        rateLimitResetCredits: { credits: [{ id: 'private-credit' }] },
      });
    const result = await readCodexAccount({ request });
    expect(result.auth).toBe('chatgpt');
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'account/read',
      'account/rateLimits/read',
    ]);
    expect(request.mock.calls[0][1]).toEqual({ refreshToken: false });
    expect(JSON.stringify(result)).not.toMatch(/private|email|planType|credits/);
  });

  it('keeps sign-in and usage failures separate from task discovery', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ account: { type: 'chatgpt' } })
      .mockRejectedValueOnce(new Error('private provider message'));
    expect(await readCodexAccount({ request })).toMatchObject({
      auth: 'chatgpt',
      limits: [],
      error: expect.stringContaining('Task linking'),
    });
    request.mockRejectedValueOnce(new Error('private token'));
    expect(JSON.stringify(await readCodexAccount({ request }))).not.toContain('private');
  });
});

describe('persistent global review allowance', () => {
  it('reserves before work, enforces spacing, and keeps failed attempts charged across instances', async () => {
    const { store, budget } = await ledger();
    const id = budget.reserve('a'.repeat(64), now);
    expect(() => new AdvisorBudget(store).reserve('b'.repeat(64), now)).toThrow('running');
    budget.finish(id, 'failed');
    expect(budget.status(now + 1000)).toMatchObject({ reason: 'spacing', remaining: 5 });
    expect(budget.status(now + policy.spacingMs)).toMatchObject({ reason: 'ready', remaining: 5 });
  });

  it('enforces six attempts per rolling day across restarts and projects', async () => {
    const { directory, budget } = await ledger();
    for (let i = 0; i < 6; i++) {
      const id = budget.reserve(String(i).repeat(64), now + i * policy.spacingMs);
      budget.finish(id, i % 2 ? 'completed' : 'failed');
    }
    const reopened = new AppStore(directory);
    cleanup.push(() => reopened.close());
    const restarted = new AdvisorBudget(reopened);
    expect(restarted.status(now + 6 * policy.spacingMs)).toMatchObject({
      reason: 'daily-limit',
      remaining: 0,
      nextRunAt: now + policy.windowMs,
    });
    expect(() => restarted.reserve('a'.repeat(64), now + 6 * policy.spacingMs)).toThrow(
      'daily-limit',
    );
    expect(restarted.status(now + policy.windowMs)).toMatchObject({
      reason: 'ready',
      remaining: 1,
    });
  });

  it('does not reset an uncertain attempt, a backward clock, or a corrupt ledger', async () => {
    const { store, budget } = await ledger();
    budget.reserve('a'.repeat(64), now);
    expect(budget.status(now + policy.timeoutMs + 1)).toMatchObject({
      reason: 'spacing',
      remaining: 5,
    });
    expect(budget.status(now - 1).reason).toBe('clock-changed');
    store.write('advisor.ledger', { unexpected: true });
    expect(budget.status(now)).toEqual({ reason: 'unavailable', remaining: 0 });
    expect(() => budget.reserve('a'.repeat(64), now)).toThrow('unavailable');
    expect(
      new AdvisorBudget({
        readStrict: () => {
          throw new Error('Corrupt JSON');
        },
        write: vi.fn(),
      }).status(now),
    ).toEqual({ reason: 'unavailable', remaining: 0 });
  });
});

describe('bounded advisor evidence', () => {
  it('includes metadata only and accounts for instructions in the token budget', () => {
    const snapshot = createDemoSnapshot();
    const repository = snapshot.repositories[0];
    repository.path = '/Users/private-person/private-repository';
    repository.remotes = [{ name: 'origin', url: 'https://user:secret@github.com/private/repo' }];
    repository.branches[0].id = '/Users/private-person/private-worktree:branch';
    repository.branches[0].title = 'SECRET-BRANCH-TITLE-NOT-USED';
    repository.branches[0].tasks![0].summary =
      'Brief summary <|endoftext|> https://example.invalid/private /Users/private-person/secret sk-abcdefghijklmnop';
    const lastReviewed = new Map(
      snapshot.repositories.flatMap((r) =>
        r.branches
          .filter((b) => b.id !== repository.branches[0].id)
          .map((b) => [b.id, now] as const),
      ),
    );
    const prepared = prepareAnalysis(snapshot, { now, lastReviewed });
    expect(prepared.estimatedTokens).toBe(
      tokenCount(prepared.input) + tokenCount(ADVISOR_INSTRUCTIONS),
    );
    expect(prepared.estimatedTokens).toBeLessThanOrEqual(
      policy.maxInputTokens - policy.framingReserveTokens,
    );
    expect(prepared.packet.coverage.included).toBeGreaterThan(10);
    expect(prepared.packet.coverage.included).toBeLessThan(prepared.packet.coverage.total);
    expect(prepared.input).not.toMatch(
      /private-person|user:secret|SECRET-BRANCH|sk-abcdefghijklmnop/,
    );
    expect(prepared.input).toContain('[credential omitted]');
    expect(
      prepared.packet.branches.some((b) => b.id === advisorBranchId(repository.branches[0].id)),
    ).toBe(true);
    expect(prepared.bindings.get(advisorBranchId(repository.branches[0].id))?.branchId).toBe(
      repository.branches[0].id,
    );
  });

  it('prioritizes unreviewed work and invalidates revisions on evidence changes, not scan timestamps', () => {
    const snapshot = createDemoSnapshot();
    const first = prepareAnalysis(snapshot, { now });
    snapshot.repositories.forEach((r) => {
      r.scannedAt = new Date(now + 1).toISOString();
    });
    expect(prepareAnalysis(snapshot, { now: now + 1 }).revision).toBe(first.revision);
    const reviewed = new Map([...first.bindings.values()].map((b) => [b.branchId, now]));
    const second = prepareAnalysis(snapshot, { now: now + 1, lastReviewed: reviewed });
    expect(second.packet.branches[0].id).not.toBe(first.packet.branches[0].id);
    const selected = first.bindings.get(first.packet.branches[0].id)!;
    const branch = snapshot.repositories
      .find((r) => r.id === selected.repositoryId)!
      .branches.find((b) => b.id === selected.branchId)!;
    branch.local = branch.local ? { ...branch.local, sha: 'f'.repeat(40) } : undefined;
    branch.worktrees.push({
      path: '/fixture',
      head: 'f'.repeat(40),
      detached: false,
      available: true,
      dirty: true,
      changedFiles: 1,
    });
    expect(prepareAnalysis(snapshot, { now: now + 1 }).revision).not.toBe(first.revision);
  });

  it('excludes unavailable sources and will not prepare a half-refreshed snapshot', () => {
    const snapshot = createDemoSnapshot();
    snapshot.repositories.forEach((r) => {
      r.error = 'Unavailable';
    });
    const prepared = prepareAnalysis(snapshot);
    expect(prepared.packet.branches).toEqual([]);
    expect(prepared.packet.coverage.unavailable).toBe(prepared.packet.coverage.total);
    snapshot.scanning = true;
    expect(() => prepareAnalysis(snapshot)).toThrow('inspection to finish');
  });

  it('keeps remote-only integration evidence on the remote copy', () => {
    const snapshot = createDemoSnapshot();
    const repo = snapshot.repositories[0];
    const branch = repo.branches[0];
    snapshot.repositories = [repo];
    repo.branches = [branch];
    branch.local = undefined;
    branch.integration = Object.fromEntries(repo.targets.map((t) => [t.name, 'integrated']));
    const prepared = prepareAnalysis(snapshot, { now });
    const fact = prepared.packet.branches[0].facts.find((f) => f.kind === 'integration');
    expect(fact?.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ local: 'unknown', remote: 'integrated' })]),
    );
  });

  it('permits review of integrated work but rejects dirty or active work even beyond the summary limit', () => {
    const snapshot = createDemoSnapshot();
    const repo = snapshot.repositories[0];
    const branch = repo.branches[0];
    snapshot.repositories = [repo];
    repo.branches = [branch];
    repo.scannedAt = new Date(now).toISOString();
    repo.github = { checkedAt: new Date(now).toISOString(), partial: false };
    branch.remote = undefined;
    branch.pullRequest = undefined;
    branch.tasks = [];
    branch.worktrees = [];
    branch.integration = Object.fromEntries(repo.targets.map((t) => [t.name, 'integrated']));
    const check = () => {
      const prepared = prepareAnalysis(snapshot, { now });
      const record = prepared.packet.branches[0];
      return validateFindings(
        {
          findings: [
            {
              branchId: record.id,
              category: 'cleanup-candidate',
              title: 'Review this completed work',
              explanation: 'Current commits appear integrated.',
              uncertainty: 'Verify current task activity before deciding what to keep.',
              evidenceIds: record.facts.map((f) => f.id),
            },
          ],
        },
        prepared,
      );
    };
    expect(check()).toHaveLength(1);
    branch.worktrees = [
      {
        path: '/fixture',
        head: branch.local!.sha,
        detached: false,
        available: true,
        dirty: false,
        changedFiles: 0,
        locked: 'Keep this workspace',
      },
    ];
    expect(check).toThrow('Cleanup');
    branch.worktrees = [];
    const targets = repo.targets;
    repo.targets = targets.map((target) => ({ ...target, source: 'cached-remote' }));
    expect(check).toThrow('Cleanup');
    repo.targets = targets.map((target) => ({ ...target, source: 'github' }));
    repo.github = { checkedAt: new Date(now).toISOString(), partial: false, error: 'Unavailable' };
    expect(check).toThrow('Cleanup');
    repo.github = { checkedAt: new Date(now).toISOString(), partial: false };
    expect(check()).toHaveLength(1);
    repo.targets = targets;
    branch.tasks = Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      title: 'Fixture',
      status: i === 3 ? 'active' : 'unknown',
      association: 'verified',
    }));
    expect(check).toThrow('Cleanup');
    branch.tasks = [];
    branch.worktrees = [
      {
        path: '/fixture',
        head: 'a'.repeat(40),
        detached: false,
        available: true,
        dirty: true,
        changedFiles: 1,
      },
    ];
    expect(check).toThrow('Cleanup');
  });

  it('requires citations from the same branch, explicit uncertainty, and bounded structured output', () => {
    const prepared = prepareAnalysis(createDemoSnapshot(), { now });
    const branch = prepared.packet.branches[0];
    const finding = {
      branchId: branch.id,
      category: 'verify',
      title: 'Review saved work',
      explanation: 'Inspect this branch.',
      uncertainty: 'Its current task activity is unknown.',
      evidenceIds: [branch.facts[0].id],
    };
    expect(validateFindings({ findings: [finding] }, prepared)[0]).toMatchObject({
      revision: prepared.revision,
      branchId: prepared.bindings.get(branch.id)!.branchId,
      preparedAt: new Date(now).toISOString(),
      checkedAt: branch.checkedAt,
    });
    expect(() =>
      validateFindings(
        { findings: [{ ...finding, evidenceIds: [prepared.packet.branches[1].facts[0].id] }] },
        prepared,
      ),
    ).toThrow('unrelated');
    expect(() =>
      validateFindings({ findings: [{ ...finding, command: 'git branch -D feature' }] }, prepared),
    ).toThrow();
    expect(() =>
      validateFindings({ findings: [{ ...finding, uncertainty: '' }] }, prepared),
    ).toThrow();
    expect(() => validateFindings({ findings: [finding, finding] }, prepared)).toThrow('duplicate');
    expect(() => validateFindings({ findings: Array(21).fill(finding) }, prepared)).toThrow();
    expect(() =>
      validateFindings(
        {
          findings: [
            {
              ...finding,
              category: 'cleanup-candidate',
              evidenceIds: branch.facts.map((f) => f.id),
            },
          ],
        },
        prepared,
      ),
    ).toThrow('Cleanup');
  });
});
