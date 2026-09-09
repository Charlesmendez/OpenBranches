import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../src/data/demo';
import { lifecycleOf } from '../src/domain/branches';
import {
  anchoredScroll,
  clusterFor,
  initialInventory,
  inventoryCursor,
  mapPositionFor,
  revealSelection,
  typeaheadIndex,
} from '../src/ui/navigation';

describe('large workspace navigation', () => {
  it('navigates the complete result set rather than only the rendered rows', () => {
    expect(inventoryCursor('End', 4, 1000, 500)).toBe(999);
    expect(inventoryCursor('ArrowDown', 999, 1000, 500)).toBe(999);
    expect(inventoryCursor('Home', 999, 1000, 500)).toBe(0);
    expect(inventoryCursor('PageDown', 7, 1000, 500)).toBe(13);
    expect(inventoryCursor('PageUp', 2, 1000, 500)).toBe(0);
    expect(inventoryCursor('End', 0, 0, 500)).toBeUndefined();
    expect(inventoryCursor('Escape', 0, 1000, 500)).toBeUndefined();
  });

  it('keeps a visible branch at the same offset when preceding rows move', () => {
    const branches = createDemoSnapshot().repositories[0].branches;
    const anchor = branches[100];
    const position = {
      ...initialInventory(),
      top: 100 * 76 + 18,
      anchorId: anchor.id,
      anchorOffset: 18,
    };
    expect(anchoredScroll(branches.slice(4), position)).toBe(96 * 76 + 18);
    expect(anchoredScroll([branches[0], ...branches], position)).toBe(101 * 76 + 18);
    expect(
      anchoredScroll(
        branches.filter((branch) => branch.id !== anchor.id),
        position,
      ),
    ).toBe(position.top);
  });

  it('reveals the selected branch in the correct lifecycle, cluster, and page', () => {
    const branches = createDemoSnapshot().repositories[0].branches;
    const selected = branches.filter((branch) => lifecycleOf(branch) === 'integrated')[70];
    const grouped = branches.filter(
      (branch) =>
        lifecycleOf(branch) === 'integrated' && clusterFor(branch) === clusterFor(selected),
    );
    const restored = revealSelection(
      { selectedId: selected.id, group: 'active', maps: {} },
      branches,
    );
    expect(restored.group).toBe('integrated');
    expect(restored.maps.integrated).toEqual({
      expanded: clusterFor(selected),
      page: Math.floor(grouped.findIndex((branch) => branch.id === selected.id) / 6),
    });
    const viewport = { x: 17, y: 22, zoom: 0.8 };
    restored.maps.integrated!.viewport = viewport;
    expect(revealSelection(restored, branches).maps.integrated?.viewport).toEqual(viewport);
    restored.maps.integrated!.page = 100;
    expect(revealSelection(restored, branches).maps.integrated?.viewport).toBeUndefined();
    expect(mapPositionFor(branches, 'missing')).toBeUndefined();
  });

  it('supports type-ahead across the full list and wraps without changing unmatched focus', () => {
    const branches = createDemoSnapshot()
      .repositories[0].branches.slice(0, 3)
      .map((branch, index) => ({
        ...branch,
        name: `codex/${index}`,
        title: ['Alpha search', 'Beta billing', 'Alpha export'][index],
      }));
    expect(typeaheadIndex(branches, 'Alpha', 0)).toBe(2);
    expect(typeaheadIndex(branches, 'Alpha', 2)).toBe(0);
    expect(typeaheadIndex(branches, 'Alpha s', 0)).toBe(0);
    expect(typeaheadIndex(branches, 'Missing', 1)).toBe(1);
    expect(typeaheadIndex([], 'a', -1)).toBe(-1);
  });
});
