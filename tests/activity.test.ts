import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import {
  activityCounts,
  activityDayLabel,
  activityItems,
  filterActivity,
  groupActivity,
  matchingActivity,
  observedActivity,
} from '../src/domain/activity';
import type { ActivityEvent } from '../src/domain/types';

const now = Date.parse('2026-09-10T16:00:00Z');

describe('activity timeline', () => {
  it('sorts, searches, scopes, counts, and groups observed events', () => {
    const repositories = createDemoSnapshot(now).repositories;
    const events: ActivityEvent[] = [
      {
        id: 'older',
        repositoryId: repositories[1].id,
        kind: 'branch',
        title: 'Branch discovered',
        detail: 'Billing audit',
        at: new Date(now - 86_400_000).toISOString(),
      },
      {
        id: 'newer',
        repositoryId: repositories[0].id,
        kind: 'commit',
        title: 'Branch tip changed',
        detail: 'Voice integration',
        at: new Date(now - 60_000).toISOString(),
      },
      {
        id: 'unknown',
        repositoryId: 'removed',
        kind: 'worktree',
        title: 'Worktree locations changed',
        detail: 'Old project',
        at: 'invalid',
      },
    ];
    const items = activityItems(events, repositories);
    expect(items.map(({ event }) => event.id)).toEqual(['newer', 'older', 'unknown']);
    expect(items[2].repositoryName).toBe('Project unavailable');
    expect(matchingActivity(items, { query: 'voice', project: 'all' })).toHaveLength(1);
    expect(matchingActivity(items, { query: '', project: repositories[1].id })[0].event.id).toBe(
      'older',
    );
    expect(activityCounts(items)).toEqual({
      all: 3,
      commit: 1,
      branch: 1,
      worktree: 1,
      integration: 0,
    });
    expect(filterActivity(items, 'commit').map(({ event }) => event.id)).toEqual(['newer']);
    expect(activityDayLabel(events[1].at, now)).toBe('Today');
    expect(activityDayLabel(events[0].at, now)).toBe('Yesterday');
    expect(activityDayLabel('invalid', now)).toBe('Date unavailable');
    expect(groupActivity(items, now).map(({ label, items }) => [label, items.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 1],
      ['Date unavailable', 1],
    ]);
  });

  it('derives precise events from local scan changes without storing worktree paths', () => {
    const previous = structuredClone(createDemoSnapshot(now).repositories[0]);
    previous.branches = [previous.branches[0]];
    const target = Object.keys(previous.branches[0].integration)[0];
    previous.branches[0].integration[target] = 'pending';
    const current = structuredClone(previous);
    current.scannedAt = new Date(now + 60_000).toISOString();
    current.branches[0].local!.sha = 'f'.repeat(40);
    current.branches[0].integration[target] = 'integrated';
    current.branches[0].worktrees.push({
      path: '/private/fixture/second-copy',
      head: 'f'.repeat(40),
      branch: current.branches[0].name,
      detached: false,
      available: true,
      dirty: false,
      changedFiles: 0,
    });
    const discovered = structuredClone(createDemoSnapshot(now).repositories[0].branches[1]);
    discovered.id = 'new-branch';
    discovered.repositoryId = current.id;
    current.branches.push(discovered);
    const events = observedActivity(previous, current);
    expect(events.map(({ kind }) => kind)).toEqual(['commit', 'worktree', 'integration', 'branch']);
    expect(events.find(({ kind }) => kind === 'integration')?.title).toBe(
      `Integrated into ${target}`,
    );
    expect(events.find(({ kind }) => kind === 'worktree')?.detail).toContain('2 available copies');
    expect(JSON.stringify(events)).not.toContain('/private/fixture');
    expect(observedActivity(current, structuredClone(current))).toEqual([]);
  });
});
