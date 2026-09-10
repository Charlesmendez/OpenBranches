import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadGitHubWork } from '../src/team/loadGitHubWork';
import type { GitHubWorkPage } from '../src/team/github';

const workspace = randomUUID();
function page(
  revision: string,
  nextCursor: string | null,
  projectId = randomUUID(),
): GitHubWorkPage {
  return {
    workspaceId: workspace,
    revision,
    checkedAt: new Date().toISOString(),
    nextCursor,
    sources: [
      {
        projectId,
        repositoryId: '51',
        fullName: 'FictionalOrg/work',
        lastAttemptAt: null,
        snapshotAt: new Date().toISOString(),
        syncState: 'current',
        branchesComplete: true,
        pullHistoryComplete: true,
        branchCount: 0,
        pullCount: 0,
        openPullCount: 0,
        branches: [],
        pulls: [],
        omittedBranches: 0,
        omittedPulls: 0,
      },
    ],
  };
}

describe('consistent GitHub work pagination', () => {
  it('restarts when workspace evidence changes between pages', async () => {
    const cursor = randomUUID(),
      githubWork = vi
        .fn()
        .mockResolvedValueOnce(page('1', cursor))
        .mockResolvedValueOnce(page('2', null))
        .mockResolvedValueOnce(page('2', cursor))
        .mockResolvedValueOnce(page('2', null));
    const loaded = await loadGitHubWork(
      { githubWork },
      workspace,
      {},
      2,
      new AbortController().signal,
    );
    expect(githubWork).toHaveBeenCalledTimes(4);
    expect(githubWork.mock.calls[2][1]).toEqual({});
    expect(loaded.revision).toBe('2');
    expect(loaded.sources).toHaveLength(2);
  });

  it('fails visibly instead of combining constantly changing permission snapshots', async () => {
    let revision = 0;
    const githubWork = vi.fn(async () => page(String(++revision), randomUUID()));
    await expect(
      loadGitHubWork({ githubWork }, workspace, {}, 2, new AbortController().signal),
    ).rejects.toThrow('GitHub work changed');
    expect(githubWork).toHaveBeenCalledTimes(4);
  });
});
