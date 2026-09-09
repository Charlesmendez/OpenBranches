import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import {
  featureBranches,
  groupCounts,
  lifecycleOf,
  recommendationsFor,
  relativeTime,
  DAY,
} from '../src/domain/branches';

describe('branch evidence', () => {
  it('accounts for every feature branch exactly once across activity groups', () => {
    for (const repo of createDemoSnapshot().repositories) {
      const branches = featureBranches(repo);
      expect(Object.values(groupCounts(branches)).reduce((a, b) => a + b, 0)).toBe(branches.length);
    }
  });
  it('does not hide a divergent remote integration branch behind a local target', () => {
    const repo = createDemoSnapshot().repositories[0];
    const divergent = {
      ...repo.branches[0],
      name: repo.targets[0].name,
      local: undefined,
      remote: { ...repo.branches[0].remote!, sha: 'different-remote-tip' },
    };
    repo.branches = [divergent];
    expect(featureBranches(repo)).toEqual([divergent]);
  });
  it('does not treat missing history or unknown dates as completed work', () => {
    const branch = createDemoSnapshot().repositories[0].branches[0];
    branch.updatedAt = '';
    branch.pullRequest = undefined;
    branch.tasks = undefined;
    branch.worktrees = [];
    branch.integration = { main: 'unknown' };
    expect(lifecycleOf(branch)).toBe('unverified');
    expect(relativeTime('')).toBe('Unknown');
    expect(relativeTime(new Date(0).toISOString())).toBe('Unknown');
  });
  it('does not suggest resuming work when the worktree status could not be read', () => {
    const repo = createDemoSnapshot().repositories[0];
    const branch = repo.branches[0];
    branch.updatedAt = new Date(Date.now() - 30 * DAY).toISOString();
    branch.pullRequest = undefined;
    branch.integration = { main: 'pending' };
    branch.worktrees = [
      {
        path: '/missing',
        head: 'abc',
        available: false,
        detached: false,
        dirty: null,
        changedFiles: null,
      },
    ];
    repo.branches = [branch];
    expect(recommendationsFor(repo).some((r) => r.category === 'forgotten')).toBe(false);
    repo.error = 'Unavailable';
    expect(recommendationsFor(repo)).toEqual([]);
  });
});
