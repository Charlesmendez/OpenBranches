import { describe, expect, it } from 'vitest';
import type { Branch, GitHubPullRequest, Repository, TaskLink } from '../src/domain/types';
import { filterWorkspaceNow, workspaceNow } from '../src/domain/workspaceNow';

const now = Date.parse('2026-09-10T16:00:00Z');
const at = new Date(now).toISOString();
const sha = 'a'.repeat(40);

const task = (overrides: Partial<TaskLink> = {}): TaskLink => ({
  id: 'task',
  tool: 'codex',
  title: 'Build the control panel',
  status: 'active',
  association: 'verified',
  checkedAt: at,
  updatedAt: at,
  ...overrides,
});

const branch = (id: string, overrides: Partial<Branch> = {}): Branch => ({
  id,
  repositoryId: 'project',
  name: `feat/${id}`,
  title: id,
  local: {
    name: `feat/${id}`,
    fullName: `refs/heads/feat/${id}`,
    sha,
    updatedAt: at,
    subject: id,
  },
  worktrees: [],
  updatedAt: at,
  integration: { develop: 'pending', main: 'pending' },
  codexNamed: false,
  detached: false,
  ...overrides,
});

const pull = (number: number, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  number,
  title: `Pull ${number}`,
  url: `https://github.com/example/project/pull/${number}`,
  state: 'open',
  draft: false,
  base: 'develop',
  repository: 'example/project',
  headName: `feat/pull-${number}`,
  headRepository: 'example/project',
  headSha: sha,
  updatedAt: at,
  observedAt: at,
  ...overrides,
});

const repository = (
  id: string,
  branches: Branch[],
  pulls: GitHubPullRequest[] = [],
): Repository => ({
  id,
  name: id,
  path: `/fixture/${id}`,
  commonDir: `/fixture/${id}/.git`,
  targets: [
    { name: 'develop', sha: 'b'.repeat(40), source: 'local' },
    { name: 'main', sha: 'c'.repeat(40), source: 'local' },
  ],
  branches: branches.map((item) => ({ ...item, repositoryId: id })),
  worktrees: [],
  remotes: [{ name: 'origin', url: 'https://github.com/example/project.git' }],
  scannedAt: at,
  shallow: false,
  github: {
    checkedAt: at,
    partial: false,
    openPullsComplete: true,
    pulls,
  },
});

describe('workspace now control panel', () => {
  it('includes only verified runtime work and open pull requests', () => {
    const live = branch('live', { tasks: [task()] });
    const waiting = branch('waiting', {
      tasks: [task({ id: 'waiting', status: 'idle', waiting: true })],
    });
    const dirty = branch('dirty', {
      worktrees: [
        {
          path: '/fixture/project/dirty',
          head: sha,
          detached: false,
          available: true,
          dirty: true,
          changedFiles: 2,
        },
      ],
    });
    const possible = branch('possible', {
      tasks: [task({ id: 'possible', association: 'possible' })],
    });
    const model = workspaceNow(
      [repository('project', [live, waiting, dirty, possible], [pull(12)])],
      now,
    );

    expect(model).toMatchObject({ live: 1, waiting: 1, pulls: 1 });
    expect(model.projects.flatMap((project) => project.rows)).toHaveLength(3);
    expect(
      model.projects.flatMap((project) => project.rows).map((row) => row.branch?.branch.id),
    ).not.toContain('dirty');
    expect(
      model.projects.flatMap((project) => project.rows).map((row) => row.branch?.branch.id),
    ).not.toContain('possible');
  });

  it('joins a live branch to its PR and de-duplicates the same PR across local clones', () => {
    const sharedPull = pull(42, { headName: 'feat/live' });
    const live = branch('live', { tasks: [task()], pullRequest: sharedPull });
    const first = repository('first-clone', [live], [sharedPull]);
    const second = repository(
      'second-clone',
      [
        branch('copy', {
          pullRequest: sharedPull,
          tasks: [task({ id: 'second-task', tool: 'claude-code' })],
        }),
      ],
      [sharedPull],
    );
    const model = workspaceNow([first, second], now);
    const rows = model.projects.flatMap((project) => project.rows);

    expect(model).toMatchObject({ live: 2, waiting: 0, pulls: 1 });
    expect(model.projects[0].pulls).toBe(1);
    expect(filterWorkspaceNow(model, 'pulls', '')[0].pulls).toBe(1);
    expect(filterWorkspaceNow(model, 'pulls', '')[0].rows).toHaveLength(1);
    expect(filterWorkspaceNow(model, 'live', '')[0].rows).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].branch?.branch.id).toBe('live');
    expect(rows[0].pull?.pull.number).toBe(42);
    expect(rows[0].pull?.repositories.map((repo) => repo.id)).toEqual([
      'first-clone',
      'second-clone',
    ]);
  });

  it('excludes unverified saved PRs from the live panel and reports that they are hidden', () => {
    const oldPull = pull(9, {
      title: 'Repair invoices',
      observedAt: new Date(now - 11 * 60_000).toISOString(),
    });
    const currentPull = pull(10, { title: 'Current billing fix' });
    const live = branch('voice', {
      title: 'Voice controls',
      tasks: [task({ tool: 'cursor', title: 'Wire voice controls' })],
    });
    const model = workspaceNow([repository('project', [live], [oldPull, currentPull])], now);
    const rows = model.projects.flatMap((project) => project.rows);

    expect(model).toMatchObject({ pulls: 1, unverifiedPulls: 1 });
    expect(rows.some((row) => row.pull?.pull.number === 9)).toBe(false);
    expect(filterWorkspaceNow(model, 'live', '')[0].rows).toHaveLength(1);
    expect(filterWorkspaceNow(model, 'pulls', '')[0].rows).toHaveLength(1);
    expect(filterWorkspaceNow(model, 'all', 'cursor')[0].rows[0].branch?.branch.id).toBe('voice');
    expect(filterWorkspaceNow(model, 'all', 'billing')[0].rows[0].pull?.pull.number).toBe(10);
    expect(filterWorkspaceNow(model, 'all', 'invoices')).toEqual([]);
    expect(filterWorkspaceNow(model, 'all', 'missing')).toEqual([]);
  });

  it('keeps a large branch inventory bounded to current evidence', () => {
    const branches = Array.from({ length: 1_000 }, (_, index) =>
      branch(`branch-${index}`, {
        tasks: index < 2 ? [task({ id: `task-${index}` })] : undefined,
      }),
    );
    const pulls = Array.from({ length: 75 }, (_, index) => pull(index + 1));
    const model = workspaceNow([repository('large-project', branches, pulls)], now);

    expect(model).toMatchObject({ live: 2, waiting: 0, pulls: 75, unverifiedPulls: 0 });
    expect(model.projects).toHaveLength(1);
    expect(model.projects[0].rows).toHaveLength(77);
  });
});
