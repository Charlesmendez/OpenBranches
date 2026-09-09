import { applyReviewCommand, readReviewState } from '../src/domain/reviewDecisions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoSnapshot } from '../src/data/demo';
import { recommendationsFor } from '../src/domain/branches';
import { groupReviews, recommendationRevision, SNOOZE_MS } from '../src/domain/reviews';
import { AppStore } from '../electron/services/store';
import { ReviewService } from '../electron/services/reviews';
import type { Snapshot } from '../src/domain/types';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const list = (snapshot: Snapshot, now = Date.now()) =>
  snapshot.repositories.flatMap((repository) => recommendationsFor(repository, now));
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'openbranches-reviews-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new AppStore(directory);
  cleanup.push(() => store.close());
  const snapshot = createDemoSnapshot();
  return {
    directory,
    store,
    snapshot,
    service: new ReviewService(
      store,
      () => snapshot,
      () => {},
    ),
  };
}
describe('review choices and evidence', () => {
  it('keeps a choice through observation refreshes and unrelated target advances, but resurfaces changed work', () => {
    const snapshot = createDemoSnapshot();
    const initial = list(snapshot);
    const item = initial[0];
    const now = Date.now();
    const state = applyReviewCommand(
      { decisions: [] },
      { id: item.id, revision: item.revision, choice: 'dismissed' },
      initial,
      now,
    );
    const repo = snapshot.repositories.find((repository) => repository.id === item.repositoryId)!;
    const branch = repo.branches.find((branch) => branch.id === item.branchId)!;
    repo.scannedAt = new Date(now + 60_000).toISOString();
    repo.targets.forEach((target) => {
      target.sha = 'f'.repeat(40);
    });
    branch.tasks?.forEach((task) => {
      task.checkedAt = new Date(now + 60_000).toISOString();
    });
    const refreshed = list(snapshot, now + 60_000);
    expect(refreshed.find((value) => value.id === item.id)?.revision).toBe(item.revision);
    expect(
      groupReviews(refreshed, state.decisions, now + 60_000).dismissed.map(
        (value) => value.finding.id,
      ),
    ).toContain(item.id);
    branch.local!.sha = 'b'.repeat(40);
    const changed = groupReviews(list(snapshot), state.decisions, now + 60_000);
    expect(changed.dismissed).toHaveLength(0);
    expect(changed.active.find((value) => value.finding.id === item.id)?.changed).toBe(true);
  });
  it('ignores evidence ordering and detects task, worktree, and integration changes', () => {
    const repository = createDemoSnapshot().repositories[0];
    const branch = repository.branches[0];
    branch.worktrees.push({ ...branch.worktrees[0], path: '/fixture/other-worktree' });
    const before = recommendationRevision(repository, branch);
    branch.tasks!.reverse();
    branch.worktrees.reverse();
    repository.targets.reverse();
    branch.integration = Object.fromEntries(Object.entries(branch.integration).reverse());
    expect(recommendationRevision(repository, branch)).toBe(before);
    branch.worktrees[0].locked = 'Keep';
    const locked = recommendationRevision(repository, branch);
    expect(locked).not.toBe(before);
    branch.tasks![0].status = 'active';
    const active = recommendationRevision(repository, branch);
    expect(active).not.toBe(locked);
    branch.integration.develop = 'integrated';
    expect(recommendationRevision(repository, branch)).not.toBe(active);
  });
  it('returns snoozed findings exactly at expiry and preserves counts across all buckets', () => {
    const recommendations = list(createDemoSnapshot());
    const item = recommendations[0];
    const now = Date.now();
    const state = applyReviewCommand(
      { decisions: [] },
      { id: item.id, revision: item.revision, choice: 'snoozed' },
      recommendations,
      now,
    );
    const before = groupReviews(recommendations, state.decisions, now + SNOOZE_MS - 1);
    expect(before.snoozed).toHaveLength(1);
    expect(Object.values(before).flat()).toHaveLength(recommendations.length);
    expect(before.active).toHaveLength(recommendations.length - 1);
    expect(groupReviews(recommendations, state.decisions, now + SNOOZE_MS).active).toHaveLength(
      recommendations.length,
    );
    expect(groupReviews(recommendations, state.decisions, now - 1).active).toHaveLength(
      recommendations.length,
    );
    const restored = applyReviewCommand(
      state,
      { id: item.id, revision: item.revision, choice: 'restore' },
      recommendations,
      now,
    );
    expect(restored.decisions).toEqual([]);
  });
  it('persists decisions across a SQLite reopen and rejects a click against superseded evidence', async () => {
    const { directory, service, snapshot } = await fixture();
    const item = list(snapshot)[0];
    const command = { id: item.id, revision: item.revision, choice: 'dismissed' };
    expect(service.decide(command).ok).toBe(true);
    const reopened = new AppStore(directory);
    cleanup.push(() => reopened.close());
    const reloaded = new ReviewService(
      reopened,
      () => snapshot,
      () => {},
    );
    expect(reloaded.currentState().decisions).toHaveLength(1);
    const branch = snapshot.repositories
      .find((repository) => repository.id === item.repositoryId)!
      .branches.find((branch) => branch.id === item.branchId)!;
    branch.local!.sha = 'c'.repeat(40);
    expect(reloaded.decide(command)).toMatchObject({
      ok: false,
      error: expect.stringContaining('changed'),
    });
    expect(groupReviews(list(snapshot), reloaded.currentState().decisions).active).toHaveLength(
      list(snapshot).length,
    );
  });
  it('can reset one project without disturbing other choices and forgets removed projects', async () => {
    const { service, snapshot, store } = await fixture();
    const items = snapshot.repositories.map((repository) => recommendationsFor(repository)[0]);
    items.forEach((item) =>
      expect(service.decide({ id: item.id, revision: item.revision, choice: 'dismissed' }).ok).toBe(
        true,
      ),
    );
    expect(service.reset(items[0].repositoryId).state.decisions).toHaveLength(2);
    snapshot.repositories = snapshot.repositories.filter(
      (repository) => repository.id !== items[1].repositoryId,
    );
    service.forgetUnselected();
    expect(service.currentState().decisions.map((value) => value.repositoryId)).toEqual([
      items[2].repositoryId,
    ]);
    expect(JSON.stringify(store.readStrict('reviews.ledger'))).not.toContain(items[1].repositoryId);
  });
  it('does not hide findings or pretend a choice was saved after storage failure', async () => {
    const { service, snapshot, store } = await fixture();
    const item = list(snapshot)[0];
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('private storage details');
    });
    const result = service.decide({ id: item.id, revision: item.revision, choice: 'dismissed' });
    expect(result).toMatchObject({ ok: false, state: { decisions: [] } });
    expect(result.error).not.toContain('private');
  });
  it('keeps findings visible when startup cannot prune an old project’s review history', async () => {
    const { service, snapshot, store } = await fixture();
    const item = list(snapshot)[0];
    expect(service.decide({ id: item.id, revision: item.revision, choice: 'dismissed' }).ok).toBe(
      true,
    );
    snapshot.repositories = [];
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('disk unavailable');
    });
    const reopened = new ReviewService(
      store,
      () => snapshot,
      () => {},
    );
    expect(reopened.currentState()).toMatchObject({ decisions: [], error: expect.any(String) });
  });
  it('treats corrupt and legacy choices as unreadable instead of guessing an evidence revision', async () => {
    expect(readReviewState({ finding: { dismissed: true } })).toMatchObject({
      decisions: [],
      error: expect.any(String),
    });
    const { store, snapshot } = await fixture();
    store.write('reviews.ledger', { version: 1, decisions: [{ until: 'forever' }] });
    const service = new ReviewService(
      store,
      () => snapshot,
      () => {},
    );
    const item = list(snapshot)[0];
    expect(service.decide({ id: item.id, revision: item.revision, choice: 'dismissed' }).ok).toBe(
      false,
    );
    expect(service.reset()).toMatchObject({ ok: true, state: { decisions: [] } });
  });
  it('gives the same fictional evidence the same revisions across demo reloads', () => {
    const origin = Date.now() - 60_000;
    expect(list(createDemoSnapshot(origin)).map((item) => item.revision)).toEqual(
      list(createDemoSnapshot(origin)).map((item) => item.revision),
    );
  });
});
