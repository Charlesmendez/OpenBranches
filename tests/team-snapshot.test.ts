import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { prepareSharedSnapshot } from '../src/team/prepareSnapshot';
import { sharedSnapshotSchema, sharedWorkStale, snapshotWithinConsent } from '../src/team/protocol';

const key = (text: string) =>
  createHmac('sha256', 'fictional-device-secret').update(text).digest('hex');
const consent = { taskTitles: false, taskSummaries: false };
describe('opt-in local metadata preparation', () => {
  it('excludes paths, prompts, raw session IDs, commit subjects, and task text by default', () => {
    const repository = createDemoSnapshot().repositories[0];
    const branch = repository.branches.find((branch) => branch.local && branch.tasks?.length)!;
    repository.branches = [branch];
    repository.path = '/Users/PrivateOwner/private-repository';
    repository.commonDir = repository.path + '/.git';
    branch.local!.subject = 'PRIVATE COMMIT SUBJECT';
    branch.title = 'PRIVATE BRANCH TITLE';
    branch.tasks![0] = {
      ...branch.tasks![0],
      id: 'PRIVATE SESSION ID',
      title: 'PRIVATE TASK TITLE',
      summary: 'PRIVATE TASK SUMMARY',
      evidence: ['PRIVATE EVIDENCE PATH'],
    };
    const value = prepareSharedSnapshot(repository, consent, key),
      serialized = JSON.stringify(value);
    expect(value.branches).toHaveLength(1);
    expect(value.branches[0].name).toBe(branch.name);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('PRIVATE');
    expect(serialized).not.toContain(repository.commonDir);
    expect(value.branches[0].tasks[0].key).not.toBe(branch.tasks![0].id);
    expect(snapshotWithinConsent(value, consent)).toBe(true);
  });
  it('has independent choices for task titles and summaries, enforced again by the server schema', () => {
    const repository = createDemoSnapshot().repositories[0];
    const branch = repository.branches.find((branch) => branch.local && branch.tasks?.length)!;
    repository.branches = [branch];
    branch.tasks![0].summary = 'Optional summary';
    const title = prepareSharedSnapshot(
      repository,
      { taskTitles: true, taskSummaries: false },
      key,
    );
    expect(title.branches[0].tasks[0].title).toBe(branch.tasks![0].title);
    expect(title.branches[0].tasks[0].summary).toBeUndefined();
    expect(snapshotWithinConsent(title, consent)).toBe(false);
    const summary = prepareSharedSnapshot(
      repository,
      { taskTitles: false, taskSummaries: true },
      key,
    );
    expect(summary.branches[0].tasks[0].title).toBeUndefined();
    expect(summary.branches[0].tasks[0].summary).toBe('Optional summary');
    expect(sharedSnapshotSchema.safeParse({ ...summary, path: '/Users/private' }).success).toBe(
      false,
    );
    expect(
      sharedSnapshotSchema.safeParse({
        ...summary,
        branches: [{ ...summary.branches[0], prompt: 'never accepted' }],
      }).success,
    ).toBe(false);
  });
  it('keeps unknown worktree status unknown and omits published-only branches', () => {
    const repository = createDemoSnapshot().repositories[0];
    const branch = repository.branches.find((branch) => branch.worktrees.length)!;
    branch.worktrees[0].dirty = null;
    branch.worktrees[0].changedFiles = null;
    const remoteOnly = { ...branch, id: 'published-only-fixture', local: undefined, worktrees: [] };
    repository.branches = [branch, remoteOnly];
    const value = prepareSharedSnapshot(repository, consent, key);
    expect(value.branches).toHaveLength(1);
    expect(value.branches[0].worktrees.dirty).toBeNull();
    expect(value.branches[0].worktrees.changedFiles).toBeNull();
  });
  it('bounds large snapshots and reports omissions without exposing unsupported metadata', () => {
    const repository = createDemoSnapshot().repositories[0],
      original = repository.branches.find((branch) => branch.local)!;
    repository.branches = Array.from({ length: 2400 }, (_, index) => ({
      ...original,
      id: `fixture-${index}`,
      name: 'work-' + index + 'x'.repeat(500),
      tasks: Array.from({ length: 12 }, (_, task) => ({
        id: `${index}-${task}`,
        tool: 'codex' as const,
        title: 'T'.repeat(512),
        summary: 'S'.repeat(1024),
        status: 'unknown' as const,
        association: 'possible' as const,
      })),
    }));
    const value = prepareSharedSnapshot(repository, { taskTitles: true, taskSummaries: true }, key);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(768_000);
    expect(value.branches.length).toBeLessThan(1000);
    expect(value.omittedBranches).toBe(2400 - value.branches.length);
    expect(value.branches[0].omittedTasks).toBe(2);
  });
  it('uses independent device keys and never invents a successful scan timestamp', () => {
    const repository = createDemoSnapshot().repositories[0];
    const a = prepareSharedSnapshot(repository, consent, key),
      b = prepareSharedSnapshot(repository, consent, (text) =>
        createHmac('sha256', 'another-device').update(text).digest('hex'),
      );
    expect(a.branches[0].key).not.toBe(b.branches[0].key);
    repository.scannedAt = 'invalid';
    expect(() => prepareSharedSnapshot(repository, consent, key)).toThrow('Refresh');
  });
  it('treats offline, expired, failed, and invalid-time devices as stale evidence', () => {
    const now = Date.now(),
      snapshot = prepareSharedSnapshot(createDemoSnapshot(now).repositories[0], consent, key);
    const work = {
      snapshot,
      receivedAt: new Date(now).toISOString(),
      deviceExpiresAt: new Date(now + 86400000).toISOString(),
    };
    expect(sharedWorkStale(work, now)).toBe(false);
    expect(sharedWorkStale(work, now + 301000)).toBe(true);
    expect(
      sharedWorkStale({ ...work, deviceExpiresAt: new Date(now - 1).toISOString() }, now),
    ).toBe(true);
    expect(sharedWorkStale({ ...work, receivedAt: 'invalid' }, now)).toBe(true);
    expect(sharedWorkStale({ ...work, snapshot: { ...snapshot, sourceError: true } }, now)).toBe(
      true,
    );
  });
});
