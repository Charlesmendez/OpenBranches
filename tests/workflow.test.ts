import { describe, expect, it } from 'vitest';
import type { Branch, Repository, TaskLink } from '../src/domain/types';
import { mapEvidence, mapTargets } from '../src/domain/mapEvidence';
import {
  branchActivity,
  idleWork,
  liveTasks,
  LIVE_ACTIVITY_TTL,
} from '../src/domain/branchActivity';
import { mapHasVisibleCard } from '../src/ui/mapViewport';
import { recommendationsFor } from '../src/domain/branches';
import { groupReviews } from '../src/domain/reviews';
import { triageFindings, triageHighlights } from '../src/domain/triage';
import {
  activeWorkspaceSpotlights,
  prioritizeWork,
  workPreviews,
  workSignal,
  workSpotlights,
} from '../src/domain/workSpotlight';
import { liveCoverage } from '../src/domain/liveCoverage';
import { primaryIntegrationTargets } from '../src/domain/integrationTargets';
const now = Date.parse('2026-09-09T20:00:00Z');
const at = new Date(now).toISOString();
const old = new Date(now - 30 * 86400000).toISOString();
const sha = 'a'.repeat(40),
  next = 'b'.repeat(40);
function branch(): Branch {
  return {
    id: 'repo:work',
    repositoryId: 'repo',
    name: 'feat/work',
    title: 'Work',
    local: {
      name: 'feat/work',
      fullName: 'refs/heads/feat/work',
      sha,
      updatedAt: old,
      subject: 'Work',
    },
    updatedAt: old,
    integration: { develop: 'integrated', main: 'pending' },
    worktrees: [],
    codexNamed: false,
    detached: false,
  };
}
function repository(b = branch()): Repository {
  return {
    id: 'repo',
    name: 'Project',
    path: '/fixture/project',
    commonDir: '/fixture/project/.git',
    branches: [b],
    worktrees: [],
    remotes: [],
    targets: [
      { name: 'develop', sha, source: 'local' },
      { name: 'main', sha: next, source: 'local' },
    ],
    scannedAt: at,
    shallow: false,
  };
}
function task(extra: Partial<TaskLink> = {}): TaskLink {
  return {
    id: 'task',
    tool: 'codex',
    title: 'Work on feature',
    association: 'verified',
    status: 'active',
    checkedAt: at,
    updatedAt: at,
    ...extra,
  };
}
describe('map evidence', () => {
  it('keeps development and stable targets visible in compact summaries', () => {
    const targets = ['develop', 'dev', 'main', 'master'].map((name) => ({
      name,
      sha,
      source: 'local' as const,
    }));
    expect(primaryIntegrationTargets(targets).map((target) => target.name)).toEqual([
      'develop',
      'main',
    ]);
    expect(primaryIntegrationTargets([{ ...targets[0], name: 'trunk', role: 'default' }])).toEqual([
      { ...targets[0], name: 'trunk', role: 'default' },
    ]);
  });

  it('checks both integration targets independently rather than selecting the first match', () => {
    const b = branch();
    b.integration.main = 'integrated';
    expect(mapEvidence(repository(b), b, now).map((e) => [e.target.name, e.connection])).toEqual([
      ['develop', 'history'],
      ['main', 'history'],
    ]);
    b.integration.main = 'pending';
    expect(mapEvidence(repository(b), b, now).map((e) => e.label)).toEqual([
      'In develop',
      'Not in main',
    ]);
  });
  it('does not draw a GitHub PR into a same-named local branch', () => {
    const b = branch();
    b.pullRequest = {
      number: 1,
      title: 'Feature',
      url: 'https://github.com/fixture/project/pull/1',
      state: 'open',
      base: 'main',
      headSha: sha,
      updatedAt: at,
      observedAt: at,
    };
    expect(mapEvidence(repository(b), b, now)[1].connection).toBeUndefined();
  });
  it('requires the exact published tip and a fresh PR destination; a diverged local copy stays separate', () => {
    const b = branch();
    b.remote = {
      ...b.local!,
      sha: next,
      remote: 'origin',
      fullName: 'refs/remotes/origin/feat/work',
    };
    b.publishedHistory = {
      repository: 'fixture/project',
      remoteName: 'origin',
      branchSha: next,
      checkedAt: at,
      unavailable: false,
      targets: [{ name: 'main', sha, state: 'pending', checkedAt: at }],
    };
    b.pullRequest = {
      repository: 'fixture/project',
      number: 1,
      title: 'Feature',
      url: 'https://github.com/fixture/project/pull/1',
      state: 'open',
      base: 'main',
      headSha: next,
      updatedAt: at,
      observedAt: at,
    };
    const repo = repository(b);
    repo.github = { checkedAt: at, partial: false };
    repo.remotes = [{ name: 'origin', url: 'https://github.com/fixture/project.git' }];
    expect(mapTargets(repo, 'github')).toEqual([
      { name: 'main', sha, source: 'github', remote: 'origin' },
    ]);
    expect(mapEvidence(repo, b, now, 'github')[0].connection).toBe('pull-request');
    b.pullRequest.repository = 'another/fork';
    expect(mapEvidence(repo, b, now, 'github')[0].connection).toBeUndefined();
    b.pullRequest.repository = 'fixture/project';
    b.pullRequest.headSha = 'c'.repeat(40);
    expect(mapEvidence(repo, b, now, 'github')[0].connection).toBeUndefined();
    b.pullRequest.headSha = next;
    b.pullRequest.retained = true;
    expect(mapEvidence(repo, b, now, 'github')[0].connection).toBeUndefined();
    expect(mapEvidence(repo, b, now)[1].connection).toBeUndefined();
  });
  it('labels cached integration and never turns missing or mismatched history into integration', () => {
    const b = branch(),
      repo = repository(b);
    repo.targets[0].source = 'cached-remote';
    expect(mapEvidence(repo, b, now)[0]).toMatchObject({
      state: 'integrated',
      stale: true,
      label: 'In develop · cached',
    });
    delete b.integration.main;
    expect(mapEvidence(repo, b, now)[1]).toMatchObject({ state: 'unknown', connection: undefined });
    b.remote = { ...b.local!, sha: next };
    b.publishedHistory = {
      repository: 'fixture/project',
      remoteName: 'origin',
      branchSha: sha,
      checkedAt: at,
      unavailable: false,
      targets: [{ name: 'main', sha: next, state: 'integrated' }],
    };
    repo.github = { checkedAt: at, partial: false };
    expect(mapEvidence(repo, b, now, 'github')[0].state).toBe('unknown');
  });
  it('preserves a verified default-branch role in the GitHub map', () => {
    const b = branch(),
      repo = repository(b);
    repo.targets = [{ name: 'trunk', sha, source: 'local', remote: 'origin', role: 'default' }];
    b.publishedHistory = {
      repository: 'fixture/project',
      remoteName: 'origin',
      branchSha: sha,
      checkedAt: at,
      unavailable: false,
      targets: [{ name: 'trunk', sha, state: 'integrated' }],
    };
    expect(mapTargets(repo, 'github')).toEqual([
      { name: 'trunk', sha, source: 'github', remote: 'origin', role: 'default' },
    ]);
  });
});
describe('source-backed branch activity', () => {
  it('expires live status and refuses possible, archived, future, and missing observations', () => {
    const b = branch();
    b.tasks = [task()];
    expect(liveTasks(b, now)).toHaveLength(1);
    expect(liveTasks(b, now + LIVE_ACTIVITY_TTL + 1)).toHaveLength(0);
    for (const extra of [
      { association: 'possible' as const },
      { archived: true },
      { checkedAt: undefined },
      { checkedAt: new Date(now + 120000).toISOString() },
    ]) {
      b.tasks = [task(extra)];
      expect(liveTasks(b, now)).toHaveLength(0);
    }
  });
  it('distinguishes recent metadata and dirty files from a running agent', () => {
    const b = branch();
    b.tasks = [task({ status: 'unknown' })];
    expect(branchActivity(b, now).kind).toBe('recent');
    b.tasks = [];
    b.worktrees = [
      {
        path: '/fixture/work',
        head: sha,
        detached: false,
        available: true,
        dirty: true,
        changedFiles: 1,
      },
    ];
    expect(branchActivity(b, now).kind).toBe('changes');
    b.worktrees = [];
    b.tasks = [task({ status: 'idle', waiting: true })];
    expect(branchActivity(b, now).kind).toBe('waiting');
  });
  it('does not call recently touched, unchecked, or active work orphaned', () => {
    const b = branch();
    expect(idleWork(b, now)).toEqual({ days: 30, unassigned: true });
    b.tasks = [task({ status: 'unknown' })];
    expect(idleWork(b, now)).toBeUndefined();
    b.tasks = [task({ status: 'idle', waiting: true, updatedAt: old })];
    expect(idleWork(b, now)).toBeUndefined();
    b.tasks = [];
    b.worktrees = [
      {
        path: '/fixture/work',
        head: sha,
        detached: false,
        available: false,
        dirty: null,
        changedFiles: null,
      },
    ];
    expect(idleWork(b, now)).toBeUndefined();
  });
});
describe('current work spotlight', () => {
  it('collects only verified live or waiting work across projects in urgency order', () => {
    const running = branch();
    running.id = 'running';
    running.repositoryId = 'live-repo';
    running.tasks = [task()];
    const liveRepository = { ...repository(running), id: 'live-repo', name: 'Live project' };

    const waiting = branch();
    waiting.id = 'waiting';
    waiting.repositoryId = 'waiting-repo';
    waiting.tasks = [task({ tool: 'claude-code', status: 'idle', waiting: true })];
    const waitingRepository = {
      ...repository(waiting),
      id: 'waiting-repo',
      name: 'Waiting project',
    };

    const changed = branch();
    changed.id = 'changed';
    changed.repositoryId = 'changed-repo';
    changed.worktrees = [
      {
        path: '/fixture/changed',
        head: sha,
        detached: false,
        available: true,
        dirty: true,
        changedFiles: 2,
      },
    ];
    const changedRepository = {
      ...repository(changed),
      id: 'changed-repo',
      path: '/fixture/changed',
    };

    const result = activeWorkspaceSpotlights(
      [changedRepository, waitingRepository, liveRepository],
      now,
    );
    expect(
      result.map(({ repository, branch: item, signal }) => [repository.id, item.id, signal.kind]),
    ).toEqual([
      ['live-repo', 'running', 'live'],
      ['waiting-repo', 'waiting', 'waiting'],
    ]);
  });

  it('keeps current work first and fills the remaining project preview with open review work', () => {
    const running = branch();
    running.id = 'running';
    running.tasks = [task()];
    const pull = branch();
    pull.id = 'pull';
    pull.updatedAt = old;
    pull.pullRequest = {
      number: 12,
      title: 'Review work',
      url: 'https://github.com/fixture/project/pull/12',
      state: 'open',
      base: 'main',
      headSha: sha,
      updatedAt: old,
    };
    const recent = branch();
    recent.id = 'recent';
    recent.updatedAt = new Date(now - 20 * 60_000).toISOString();
    const previews = workPreviews([recent, pull, running], '/fixture/project', now);
    expect(previews.map(({ branch }) => branch.id)).toEqual(['running', 'pull']);
    expect(previews[0].signal?.kind).toBe('live');
    expect(previews[1].signal).toBeUndefined();
  });

  it('puts fresh verified agent runtime first and names the coding tool', () => {
    const ordinary = branch();
    ordinary.id = 'ordinary';
    const running = branch();
    running.id = 'running';
    running.tasks = [task()];
    expect(workSignal(running, '/fixture/project', now)).toMatchObject({
      kind: 'live',
      label: 'Codex working now',
      tools: ['codex'],
    });
    expect(prioritizeWork([ordinary, running], '/fixture/project', now).map((b) => b.id)).toEqual([
      'running',
      'ordinary',
    ]);
  });

  it('surfaces the current dirty checkout without inventing an active agent', () => {
    const current = branch();
    current.worktrees = [
      {
        path: '/fixture/project/',
        head: sha,
        branch: 'feat/work',
        detached: false,
        available: true,
        dirty: true,
        changedFiles: 2,
      },
    ];
    current.tasks = [task({ association: 'possible' })];
    expect(workSignal(current, '/fixture/project', now)).toMatchObject({
      kind: 'changes',
      label: 'Local changes here',
      tools: [],
    });
    expect(workSignal(current, '/fixture/project', now)?.detail).toContain(
      'active person or agent is not confirmed',
    );
    expect(workSpotlights([current], '/fixture/project', now)).toHaveLength(1);
  });

  it('labels a clean project-root branch as the current checkout without calling it live', () => {
    const current = branch();
    current.worktrees = [
      {
        path: '/fixture/project',
        head: sha,
        branch: 'feat/work',
        detached: false,
        available: true,
        dirty: false,
        changedFiles: 0,
      },
    ];
    expect(workSignal(current, '/fixture/project', now)).toMatchObject({
      kind: 'checkout',
      label: 'Current checkout',
      tools: [],
    });
  });
});
describe('live coverage labels', () => {
  const github = { configured: false, connected: false };
  it('does not describe Codex task history as configured live detection', () => {
    expect(
      liveCoverage({
        github,
        codex: {
          installed: true,
          enabled: true,
          state: 'ready',
          liveState: 'unavailable',
        },
        liveAgents: [
          {
            tool: 'codex',
            enabled: false,
            installed: false,
            state: 'not-connected',
            activeCount: 0,
          },
        ],
      }),
    ).toEqual({ sources: [], configured: false });
  });
  it('reports only live sources that are actually listening', () => {
    expect(
      liveCoverage({
        github,
        codex: { installed: true, enabled: true, state: 'ready', liveState: 'connected' },
        liveAgents: [
          {
            tool: 'codex',
            enabled: true,
            installed: true,
            state: 'listening',
            activeCount: 1,
          },
          {
            tool: 'claude-code',
            enabled: true,
            installed: true,
            state: 'error',
            activeCount: 0,
          },
        ],
      }),
    ).toEqual({ sources: ['Codex'], configured: true });
  });
});
describe('attention triage at scale', () => {
  it('turns 1,000 matching rules into 500 branch rows without dropping evidence', () => {
    const repo = repository();
    repo.branches = Array.from({ length: 500 }, (_, i) => ({
      ...branch(),
      id: `repo:${i}`,
      name: `feature/${i}`,
      title: `Feature ${i}`,
      integration: { main: 'pending' as const },
    }));
    const findings = groupReviews(recommendationsFor(repo, now), [], now).active;
    expect(findings).toHaveLength(1000);
    const items = triageFindings(findings, [repo]);
    expect(items).toHaveLength(500);
    expect(items.every((i) => i.findings.length === 2)).toBe(true);
    expect(triageHighlights(items)).toHaveLength(5);
    expect(new Set(items.map((i) => i.queue)).size).toBe(1);
  });
  it('keeps separate repositories with matching branch names and diversifies the starting list', () => {
    const repos = Array.from({ length: 8 }, (_, i) => {
      const repo = repository();
      repo.id = `repo${i}`;
      repo.branches = Array.from({ length: 10 }, (_, j) => ({
        ...branch(),
        id: `repo${i}:${j}`,
        repositoryId: repo.id,
      }));
      return repo;
    });
    const items = triageFindings(
      groupReviews(
        repos.flatMap((r) => recommendationsFor(r, now)),
        [],
        now,
      ).active,
      repos,
    );
    expect(items).toHaveLength(80);
    expect(new Set(triageHighlights(items).map((i) => i.repositoryId)).size).toBe(5);
  });
  it('respects saved decisions before grouping and restores changed evidence', () => {
    const repo = repository();
    const findings = recommendationsFor(repo, now);
    const decisions = findings.map((f) => ({
      id: f.id,
      repositoryId: repo.id,
      revision: f.revision,
      choice: 'dismissed' as const,
      decidedAt: now,
    }));
    expect(triageFindings(groupReviews(findings, decisions, now).active, [repo])).toHaveLength(0);
    repo.branches[0].local!.sha = next;
    expect(
      triageFindings(groupReviews(recommendationsFor(repo, now), decisions, now).active, [repo]),
    ).toHaveLength(1);
  });
});
describe('map viewport recovery', () => {
  const cards = [
    { x: 0, y: 0, width: 320, height: 205 },
    { x: 700, y: 400, width: 320, height: 205 },
  ];
  it('detects empty, corrupt and offscreen saved views', () => {
    expect(mapHasVisibleCard(cards, { x: 20, y: 20, zoom: 0.7 }, 800, 450)).toBe(true);
    for (const viewport of [
      { x: 10000, y: 10000, zoom: 1 },
      { x: NaN, y: 0, zoom: 1 },
      { x: 0, y: 0, zoom: 0 },
    ])
      expect(mapHasVisibleCard(cards, viewport, 800, 450)).toBe(false);
    expect(mapHasVisibleCard([], { x: 0, y: 0, zoom: 1 }, 800, 450)).toBe(false);
  });
  it('does not mistake the space between cards for visible content', () => {
    expect(mapHasVisibleCard(cards, { x: -340, y: -210, zoom: 1 }, 300, 180)).toBe(false);
  });
});
