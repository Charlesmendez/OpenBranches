import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadTeamView } from '../src/team/loadView';
import type { TeamPage } from '../src/team/responses';
const workspace = randomUUID(),
  project = randomUUID(),
  member = randomUUID();
function page(revision: string, nextCursor: string | null, deviceId = randomUUID()): TeamPage {
  return {
    workspace: { id: workspace, name: 'Fictional team', revision },
    people: [],
    projects: [],
    work: [
      {
        deviceId,
        memberId: member,
        projectId: project,
        deviceName: 'Fictional Mac',
        deviceExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        epoch: 1,
        sequence: 1,
        receivedAt: new Date().toISOString(),
        snapshot: {
          version: 1,
          observedAt: new Date().toISOString(),
          branches: [],
          omittedBranches: 0,
          sourceError: false,
        },
      },
    ],
    nextCursor,
    checkedAt: new Date().toISOString(),
    coverage: { people: true, projects: true },
    totals: { people: 1, projects: 1, reports: 0, snapshots: 2, stale: 0, omitted: 0 },
  };
}
describe('consistent team pagination', () => {
  it('discards mixed revisions and restarts from the first page', async () => {
    const cursor = randomUUID() + ':' + project;
    const view = vi
      .fn()
      .mockResolvedValueOnce(page('1', cursor))
      .mockResolvedValueOnce(page('2', null))
      .mockResolvedValueOnce(page('2', cursor))
      .mockResolvedValueOnce(page('2', null));
    const loaded = await loadTeamView({ view }, workspace, {}, 2, new AbortController().signal);
    expect(view).toHaveBeenCalledTimes(4);
    expect(view.mock.calls[2][1]).toEqual({});
    expect(loaded.workspace.revision).toBe('2');
    expect(loaded.work).toHaveLength(2);
    expect(loaded.limitReached).toBe(false);
  });
  it('fails visibly instead of stitching a constantly changing team view', async () => {
    let version = 0;
    const view = vi.fn(async () => page(String(++version), randomUUID() + ':' + project));
    await expect(
      loadTeamView({ view }, workspace, {}, 2, new AbortController().signal),
    ).rejects.toThrow('Shared work changed');
    expect(view).toHaveBeenCalledTimes(4);
  });
  it('stops loading once the aggregate metadata budget is reached', async () => {
    const large = page('1', randomUUID() + ':' + project);
    const snapshot = large.work[0].snapshot;
    snapshot.branches = Array.from({ length: 65 }, (_, index) => ({
      key: index.toString(16).padStart(64, '0'),
      name: 'feat/fictional-report-' + index,
      detached: false,
      localSha: 'b'.repeat(40),
      worktrees: { total: 1, available: 1, dirty: 0, changedFiles: 0 },
      integration: [],
      tasks: Array.from({ length: 10 }, (_, task) => ({
        key: task.toString(16).padStart(64, '0'),
        tool: 'codex' as const,
        association: 'verified' as const,
        summary: 'x'.repeat(1000),
      })),
      omittedTasks: 0,
    }));
    large.work = Array.from({ length: 10 }, () => ({ ...large.work[0], deviceId: randomUUID() }));
    const view = vi.fn(async () => structuredClone(large));
    const loaded = await loadTeamView({ view }, workspace, {}, 10, new AbortController().signal);
    expect(loaded.limitReached).toBe(true);
    expect(view.mock.calls.length).toBeLessThan(10);
    expect(loaded.nextCursor).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(loaded)).byteLength).toBeLessThan(16_000_000);
  });
});
