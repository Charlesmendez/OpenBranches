import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import {
  featureBranches,
  groupCounts,
  lifecycleOf,
  locationOf,
  recommendationsFor,
  relativeTime,
  DAY,
} from '../src/domain/branches';
import { remoteDestinationLabel, remoteEvidenceLabel, remoteIdentity } from '../src/domain/remotes';

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
  it('does not call known active task work forgotten solely because its last commit is old', () => {
    const repo = createDemoSnapshot().repositories[0];
    const branch = repo.branches[0];
    repo.branches = [branch];
    branch.worktrees = [];
    branch.pullRequest = undefined;
    branch.updatedAt = new Date(Date.now() - 30 * DAY).toISOString();
    expect(branch.tasks?.some((task) => task.status === 'active')).toBe(true);
    expect(recommendationsFor(repo).some((item) => item.category === 'forgotten')).toBe(false);
    branch.tasks = [];
    expect(recommendationsFor(repo).some((item) => item.category === 'forgotten')).toBe(true);
  });
  it('names the exact Git remote without implying that Codex runs there', () => {
    const repo = createDemoSnapshot().repositories[0];
    const branch = repo.branches[0];
    branch.local = branch.local ?? {
      name: branch.name,
      fullName: `refs/heads/${branch.name}`,
      sha: 'a'.repeat(40),
      updatedAt: new Date().toISOString(),
      subject: branch.title,
    };
    branch.remote = {
      ...(branch.remote ?? branch.local),
      remote: 'origin',
      source: 'github',
      presence: 'present',
    };
    repo.remotes = [{ name: 'origin', url: 'git@github.com:Charlesmendez/OpenBranches.git' }];
    const remote = remoteIdentity(repo, branch)!;
    expect(remote).toMatchObject({
      name: 'origin',
      host: 'github.com',
      destination: 'github.com/Charlesmendez/OpenBranches',
      state: 'published',
    });
    expect(remoteEvidenceLabel(remote, true)).toBe('Published to origin · github.com');
    expect(remoteDestinationLabel(remote)).toBe('origin · github.com/Charlesmendez/OpenBranches');
    expect(locationOf(branch, repo)).toBe('On this Mac and Published to origin · github.com');
    branch.remote.source = undefined;
    branch.remote.presence = undefined;
    expect(remoteEvidenceLabel(remoteIdentity(repo, branch)!)).toBe('Tracking origin');
    branch.remote.source = 'github';
    branch.remote.presence = 'missing';
    expect(remoteEvidenceLabel(remoteIdentity(repo, branch)!)).toBe(
      'origin copy no longer on GitHub',
    );
  });
});
