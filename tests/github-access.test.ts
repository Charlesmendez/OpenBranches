import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { githubOwnerAccess, githubRepositoryAccess } from '../src/domain/githubAccess';

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

  it('groups monitored projects by owner and distinguishes installation scope', () => {
    const repositories = createDemoSnapshot().repositories.slice(0, 2);
    repositories[0].remotes = [
      { name: 'origin', url: 'git@github.com:Charlesmendez/openbranches.git' },
    ];
    repositories[1].remotes = [
      { name: 'origin', url: 'https://github.com/datagran-auth/product.git' },
      { name: 'backup', url: 'git@github.com:datagran-auth/product.git' },
    ];

    expect(
      githubOwnerAccess(repositories, [
        {
          account: 'datagran-auth',
          accountType: 'Organization',
          repositorySelection: 'all',
        },
      ]),
    ).toEqual([
      {
        owner: 'Charlesmendez',
        projectCount: 1,
        unavailableCount: 0,
        state: 'not-installed',
      },
      {
        owner: 'datagran-auth',
        projectCount: 1,
        unavailableCount: 0,
        accountType: 'Organization',
        repositorySelection: 'all',
        state: 'connected',
      },
    ]);
  });

  it('keeps selected-repository installations visible as incomplete coverage', () => {
    const repository = createDemoSnapshot().repositories[0];
    expect(
      githubOwnerAccess(
        [repository],
        [{ account: 'example', accountType: 'User', repositorySelection: 'selected' }],
      )[0],
    ).toMatchObject({ owner: 'example', state: 'selected', repositorySelection: 'selected' });
    expect(githubOwnerAccess([repository], undefined)[0].state).toBe('checking');
    expect(githubOwnerAccess([repository], [], true)[0].state).toBe('checking');
  });
});
