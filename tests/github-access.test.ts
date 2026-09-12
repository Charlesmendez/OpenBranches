import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { githubRepositoryAccess } from '../src/domain/githubAccess';

describe('GitHub repository access', () => {
  it('keeps identity authorization separate from repository installation failures', () => {
    const repository = createDemoSnapshot().repositories[0];
    repository.github = {
      checkedAt: repository.scannedAt,
      partial: true,
      error: "Repository unavailable on GitHub. Check the app's repository access.",
    };

    expect(githubRepositoryAccess([repository])).toEqual({
      projectCount: 1,
      observedCount: 1,
      unavailableCount: 1,
      unavailableNames: [repository.name],
    });
  });

  it('ignores refresh errors that do not indicate missing repository access', () => {
    const repository = createDemoSnapshot().repositories[0];
    repository.github = {
      checkedAt: repository.scannedAt,
      partial: true,
      error: 'GitHub is rate limited.',
    };

    expect(githubRepositoryAccess([repository]).unavailableCount).toBe(0);
  });
});
