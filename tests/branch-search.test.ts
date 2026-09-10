import { describe, expect, it } from 'vitest';
import { branchSearchResults } from '../src/domain/branchSearch';
import type { Branch, Repository, TaskLink } from '../src/domain/types';

const now = Date.parse('2026-09-09T20:00:00.000Z');
const sha = 'a'.repeat(40);
const branch = (id: string, title: string, updatedAt = '2026-09-09T19:00:00.000Z'): Branch => ({
  id,
  repositoryId: 'project',
  name: `feat/${id}`,
  title,
  local: {
    name: `feat/${id}`,
    fullName: `refs/heads/feat/${id}`,
    sha,
    updatedAt,
    subject: title,
  },
  worktrees: [],
  updatedAt,
  integration: { develop: 'pending', main: 'pending' },
  codexNamed: false,
  detached: false,
});
const repository = (id: string, name: string, branches: Branch[]): Repository => ({
  id,
  name,
  path: `/fixture/${id}`,
  commonDir: `/fixture/${id}/.git`,
  targets: [
    { name: 'develop', sha: 'b'.repeat(40), source: 'local' },
    { name: 'main', sha: 'c'.repeat(40), source: 'local' },
  ],
  branches: branches.map((item) => ({ ...item, repositoryId: id })),
  worktrees: [],
  remotes: [],
  scannedAt: new Date(now).toISOString(),
  shallow: false,
});
const task = (overrides: Partial<TaskLink> = {}): TaskLink => ({
  id: 'task',
  tool: 'codex',
  title: 'Implement command palette',
  status: 'active',
  association: 'verified',
  checkedAt: new Date(now - 10_000).toISOString(),
  ...overrides,
});

describe('branch search', () => {
  it('puts fresh verified live work before newer ordinary branches', () => {
    const live = branch('live', 'Live branch', '2026-09-08T19:00:00.000Z');
    live.tasks = [task()];
    const recent = branch('recent', 'Recent branch', '2026-09-09T19:59:00.000Z');
    const results = branchSearchResults(
      [repository('project', 'Project', [recent, live])],
      '',
      now,
    );
    expect(results.map(({ branch: item }) => item.id)).toEqual(['live', 'recent']);
    expect(results[0].activity).toMatchObject({ kind: 'live', label: 'Codex working now' });
  });

  it('uses text relevance before live status for a typed query', () => {
    const exact = branch('billing', 'Billing');
    const incidental = branch('live', 'Improve billing exports');
    incidental.tasks = [task()];
    const results = branchSearchResults(
      [repository('project', 'Project', [incidental, exact])],
      'billing',
      now,
    );
    expect(results.map(({ branch: item }) => item.id)).toEqual(['billing', 'live']);
  });

  it('matches terms across project, tool, task, title, and branch fields', () => {
    const result = branch('palette', 'Command palette');
    result.tasks = [task({ tool: 'claude-code' })];
    const results = branchSearchResults(
      [repository('atlas', 'Atlas API', [result])],
      'atlas claude command feat/palette',
      now,
    );
    expect(results).toHaveLength(1);
  });

  it('matches word prefixes without treating voice as part of invoice', () => {
    const voice = branch('voice', 'Voice integration');
    const invoice = branch('invoice', 'Invoice export');
    const results = branchSearchResults(
      [repository('project', 'Project', [invoice, voice])],
      'voice',
      now,
    );
    expect(results.map(({ branch: item }) => item.id)).toEqual(['voice']);
  });

  it('does not label stale or possible sessions as active', () => {
    const possible = branch('possible', 'Possible link');
    possible.tasks = [task({ association: 'possible' })];
    const stale = branch('stale', 'Stale link');
    stale.tasks = [task({ checkedAt: new Date(now - 10 * 60_000).toISOString() })];
    expect(
      branchSearchResults([repository('project', 'Project', [possible, stale])], '', now).map(
        ({ activity }) => activity,
      ),
    ).toEqual([undefined, undefined]);
  });

  it('omits integration target refs from branch results', () => {
    const target = branch('develop', 'Develop');
    target.name = 'develop';
    target.local = { ...target.local!, name: 'develop', fullName: 'refs/heads/develop' };
    const project = repository('project', 'Project', [target]);
    project.targets[0] = { ...project.targets[0], sha };
    expect(branchSearchResults([project], '', now)).toEqual([]);
  });
});
