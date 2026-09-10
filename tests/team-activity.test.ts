import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { sharedTaskActivity } from '../src/team/activity';
import { prepareSharedSnapshot } from '../src/team/prepareSnapshot';

const key = (text: string) => createHmac('sha256', 'fictional-device').update(text).digest('hex');

function fixture(now: number) {
  const repository = createDemoSnapshot(now).repositories[0],
    branch = repository.branches.find((value) => value.local && value.tasks?.length)!;
  repository.branches = [branch];
  branch.tasks![0] = {
    ...branch.tasks![0],
    association: 'verified',
    status: 'active',
    activitySource: 'codex-runtime',
    checkedAt: new Date(now).toISOString(),
  };
  const snapshot = prepareSharedSnapshot(
    repository,
    { taskTitles: false, taskSummaries: false },
    key,
  );
  return {
    branch: snapshot.branches[0],
    work: {
      snapshot,
      receivedAt: new Date(now).toISOString(),
      deviceExpiresAt: new Date(now + 86_400_000).toISOString(),
    },
  };
}

describe('shared live task evidence', () => {
  it('labels only fresh verified runtime observations as live', () => {
    const now = Date.now(),
      { work, branch } = fixture(now);
    expect(sharedTaskActivity(work, branch, now)).toMatchObject({
      kind: 'live',
      label: 'Codex working',
    });
    branch.tasks[0].tool = 'cursor';
    branch.tasks[0].activitySource = 'cursor-hook';
    branch.tasks[0].model = { id: 'grok-code-fast-1', provider: 'xai' };
    expect(sharedTaskActivity(work, branch, now)).toMatchObject({
      kind: 'live',
      label: 'Cursor · Grok working',
    });
    branch.tasks[0].association = 'possible';
    expect(sharedTaskActivity(work, branch, now)).toBeUndefined();
  });

  it('keeps waiting distinct and expires old device evidence', () => {
    const now = Date.now(),
      { work, branch } = fixture(now);
    branch.tasks[0].waiting = true;
    branch.tasks[0].status = 'idle';
    expect(sharedTaskActivity(work, branch, now)).toMatchObject({
      kind: 'waiting',
      label: 'Codex waiting for input',
    });
    expect(sharedTaskActivity(work, branch, now + 301_000)).toBeUndefined();
  });

  it('never treats saved task state without runtime provenance as live', () => {
    const now = Date.now(),
      { work, branch } = fixture(now);
    delete branch.tasks[0].activitySource;
    expect(sharedTaskActivity(work, branch, now)).toBeUndefined();
  });
});
