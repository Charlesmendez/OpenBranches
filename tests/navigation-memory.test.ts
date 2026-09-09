import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationMemory, NAVIGATION_STORAGE_KEY } from '../src/ui/navigationMemory';
import { peoplePosition, updatePeoplePosition } from '../src/ui/peopleNavigation';
import { initialInventory } from '../src/ui/navigation';

function storage(initial?: string) {
  const data = new Map(initial === undefined ? [] : [[NAVIGATION_STORAGE_KEY, initial]]);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
}
afterEach(() => vi.useRealTimers());

describe('saved workspace positions', () => {
  it('restores people filters across branch navigation and restarts, isolated from the demo', () => {
    const disk = storage();
    const memory = new NavigationMemory(() => disk);
    const position = peoplePosition({
      query: 'review sharing',
      person: '20',
      project: 'example/project',
      tool: 'claude-code',
      filter: 'requested',
      page: 3,
      peoplePage: 1,
    });
    memory.rememberPeople('live', position);
    memory.rememberWorkspace('live', { projectId: 'branch-project', view: 'inventory' });
    memory.rememberWorkspace('live', { projectId: null, view: 'people' });
    memory.flush();
    const restored = new NavigationMemory(() => disk);
    expect(restored.workspace('live').view).toBe('people');
    expect(restored.people('live')).toEqual(position);
    expect(restored.people('demo').query).toBe('');
    expect(updatePeoplePosition(position, { person: null })).toMatchObject({
      page: 0,
      peoplePage: 1,
    });
    expect(updatePeoplePosition(position, { query: 'new search' })).toMatchObject({
      page: 0,
      peoplePage: 0,
    });
    expect(
      peoplePosition({
        page: Infinity,
        peoplePage: -1,
        query: 'x'.repeat(3000),
        filter: 'invalid',
        tool: 'future-tool',
      }),
    ).toMatchObject({ page: 0, peoplePage: 0, query: '', filter: 'open', tool: 'unknown' });
  });

  it('restores the workspace, selection, inventory, and separate map groups after a new instance', () => {
    const disk = storage();
    const first = new NavigationMemory(() => disk);
    const position = {
      selectedId: 'branch-6',
      group: 'integrated' as const,
      inventory: {
        ...initialInventory(),
        query: 'search',
        location: 'local' as const,
        top: 7640,
        left: 280,
        anchorId: 'branch-101',
        anchorOffset: 40,
        activeId: 'branch-102',
      },
      maps: {
        integrated: {
          expanded: 'tracked' as const,
          page: 2,
          viewport: { x: 80.5, y: -25.3, zoom: 0.7 },
        },
        active: { expanded: null, page: 0 },
      },
    };
    first.remember('live', 'repo', position);
    first.rememberWorkspace('live', { projectId: 'repo', view: 'inventory' });
    first.flush();
    const restored = new NavigationMemory(() => disk);
    expect(restored.workspace('live')).toEqual({ projectId: 'repo', view: 'inventory' });
    expect(restored.read('live', 'repo')).toEqual(position);
    expect(restored.read('demo', 'repo').selectedId).toBeNull();
  });
  it('keeps mode histories separate and prunes removed projects without affecting the other mode', () => {
    const disk = storage();
    const memory = new NavigationMemory(() => disk);
    for (const mode of ['live', 'demo'] as const) {
      memory.remember(mode, 'same-id', { selectedId: mode });
      memory.rememberWorkspace(mode, { projectId: 'same-id', view: 'map' });
    }
    memory.prune('live', new Set());
    memory.flush();
    const restored = new NavigationMemory(() => disk);
    expect(restored.workspace('live').projectId).toBeNull();
    expect(restored.read('live', 'same-id').selectedId).toBeNull();
    expect(restored.read('demo', 'same-id').selectedId).toBe('demo');
    expect(restored.initialMode(true)).toBe('demo');
    restored.rememberWorkspace('live', { projectId: null, view: 'map' });
    expect(restored.initialMode(false)).toBe('demo');
    restored.flush();
  });
  it('coalesces scroll updates and allows a synchronous final flush', () => {
    vi.useFakeTimers();
    const disk = storage();
    const memory = new NavigationMemory(() => disk);
    for (let top = 1; top <= 100; top++)
      memory.remember('live', 'repo', { inventory: { ...initialInventory(), top } });
    expect(disk.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(disk.setItem).not.toHaveBeenCalled();
    memory.flush();
    expect(disk.setItem).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(disk.setItem).toHaveBeenCalledTimes(1);
    expect(new NavigationMemory(() => disk).read('live', 'repo').inventory?.top).toBe(100);
  });
  it('keeps session state through a failed write, reports the failure, and retries without losing changes', () => {
    const disk = storage();
    let writable = false;
    const memory = new NavigationMemory(() => ({
      ...disk,
      setItem: (key, value) => {
        if (!writable) throw new Error('private storage failure');
        disk.setItem(key, value);
      },
    }));
    const notify = vi.fn();
    const unsubscribe = memory.subscribe(notify);
    memory.remember('live', 'repo', { selectedId: 'new-work' });
    memory.flush();
    expect(memory.read('live', 'repo').selectedId).toBe('new-work');
    expect(memory.getNotice()).toContain('could not be saved');
    expect(memory.getNotice()).not.toContain('private');
    expect(notify).toHaveBeenCalledTimes(1);
    writable = true;
    memory.saveNow();
    expect(memory.getNotice()).toBeNull();
    expect(new NavigationMemory(() => disk).read('live', 'repo').selectedId).toBe('new-work');
    unsubscribe();
  });
  it('recovers from unavailable, corrupt, unsupported, and oversized storage without crashing', () => {
    for (const data of ['{broken', '{"version":999}', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const disk = storage(data);
      const memory = new NavigationMemory(() => disk);
      expect(memory.getNotice()).toContain('could not be restored');
      expect(memory.workspace('live')).toEqual({ projectId: null, view: 'map' });
      memory.saveNow();
      expect(new NavigationMemory(() => disk).getNotice()).toBeNull();
    }
    const memory = new NavigationMemory(() => {
      throw new Error('Access denied');
    });
    expect(memory.getNotice()).toContain('could not be restored');
  });
  it('bounds and validates loaded fields without coercing malformed values or retaining commands', () => {
    const disk = storage(
      JSON.stringify({
        version: 1,
        workspaces: { live: { projectId: 'repo', view: 'run-command' } },
        projects: {
          live: [
            {
              id: 'repo',
              position: {
                group: 'invalid',
                selectedId: { private: true },
                command: 'private command',
                inventory: {
                  query: 'x'.repeat(2049),
                  top: -1,
                  left: 1e99,
                  location: { toString: 'not callable' },
                },
                maps: {
                  active: {
                    page: -3,
                    expanded: { toString: 'not callable' },
                    viewport: { x: 1e99, y: 0, zoom: 0 },
                  },
                  evil: { command: 'private command' },
                },
              },
            },
          ],
        },
      }),
    );
    const memory = new NavigationMemory(() => disk);
    expect(memory.getNotice()).toBeNull();
    expect(memory.workspace('live').view).toBe('map');
    expect(memory.read('live', 'repo')).toMatchObject({
      selectedId: null,
      group: 'active',
      inventory: { query: '', top: 0, left: 0, location: 'all' },
      maps: { active: { expanded: null, page: 0 } },
    });
    memory.saveNow();
    expect(disk.data.get(NAVIGATION_STORAGE_KEY)).not.toContain('private command');
    expect(memory.read('live', 'repo').maps.active).not.toHaveProperty('viewport');
  });
  it('bounds saved projects by recency while preserving a revisited project', () => {
    const disk = storage();
    const memory = new NavigationMemory(() => disk);
    for (let index = 0; index < 100; index++)
      memory.remember('live', `repo-${index}`, { selectedId: 'work' });
    memory.rememberWorkspace('live', { projectId: 'repo-0', view: 'map' });
    memory.remember('live', 'repo-100', { selectedId: 'new' });
    memory.flush();
    const restored = new NavigationMemory(() => disk);
    expect(restored.read('live', 'repo-0').selectedId).toBe('work');
    expect(restored.read('live', 'repo-1').selectedId).toBeNull();
    expect(restored.read('live', 'repo-100').selectedId).toBe('new');
  });
});
