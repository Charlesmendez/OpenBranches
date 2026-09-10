import { describe, expect, it } from 'vitest';
import { revealPathFor } from '../electron/git/revealPath';
import { createDemoSnapshot } from '../src/data/demo';

describe('worktree reveal paths', () => {
  it('selects only an available worktree from the requested branch', () => {
    const repository = createDemoSnapshot().repositories[0],
      branch = repository.branches[0],
      first = { ...repository.worktrees[0], path: '/fixture/primary', available: true },
      second = { ...first, path: '/fixture/linked' },
      missing = { ...first, path: '/fixture/missing', available: false };
    branch.worktrees = [first, second, missing];
    expect(revealPathFor(repository, branch.id, second.path)).toBe(second.path);
    expect(() => revealPathFor(repository, branch.id, missing.path)).toThrow('unavailable');
    expect(() => revealPathFor(repository, branch.id, '/private/unrelated')).toThrow('unavailable');
  });

  it('falls back to the first available checkout or repository folder', () => {
    const repository = createDemoSnapshot().repositories[0],
      branch = repository.branches[0];
    branch.worktrees = [
      { ...repository.worktrees[0], path: '/fixture/missing', available: false },
      { ...repository.worktrees[0], path: '/fixture/available', available: true },
    ];
    expect(revealPathFor(repository, branch.id)).toBe('/fixture/available');
    branch.worktrees = [];
    expect(revealPathFor(repository, branch.id)).toBe(repository.path);
    expect(revealPathFor(repository)).toBe(repository.path);
    expect(() => revealPathFor(repository, 'missing-branch')).toThrow('no longer exists');
  });
});
