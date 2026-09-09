import type { Branch, Lifecycle } from '../domain/types';
import { lifecycleOf } from '../domain/branches';

export const INVENTORY_ROW_HEIGHT = 76;
export const INVENTORY_HEADER_HEIGHT = 44;
export const MAP_PAGE_SIZE = 6;
export type ClusterId = 'review' | 'local' | 'tracked';
export interface MapPosition {
  expanded: ClusterId | null;
  page: number;
  source?: 'local' | 'github';
  viewport?: { x: number; y: number; zoom: number };
}
export interface InventoryPosition {
  query: string;
  location: 'all' | 'local' | 'remote';
  lifecycle: 'all' | Lifecycle;
  top: number;
  left: number;
  anchorId?: string;
  anchorOffset?: number;
  activeId?: string;
}
export interface ProjectPosition {
  selectedId: string | null;
  group: Lifecycle;
  inventory?: InventoryPosition;
  maps: Partial<Record<Lifecycle, MapPosition>>;
}
export const initialInventory = (): InventoryPosition => ({
  query: '',
  location: 'all',
  lifecycle: 'all',
  top: 0,
  left: 0,
});
export function clusterFor(branch: Branch): ClusterId {
  return branch.pullRequest?.state === 'open' ? 'review' : branch.remote ? 'tracked' : 'local';
}
export function mapPositionFor(
  branches: Branch[],
  selectedId: string | null,
): MapPosition | undefined {
  const selected = branches.find((branch) => branch.id === selectedId);
  if (!selected) return;
  const expanded = clusterFor(selected);
  const index = branches
    .filter((branch) => clusterFor(branch) === expanded)
    .findIndex((branch) => branch.id === selectedId);
  return { expanded, page: Math.floor(index / MAP_PAGE_SIZE) };
}

export function revealSelection(position: ProjectPosition, branches: Branch[]): ProjectPosition {
  const selected = branches.find((branch) => branch.id === position.selectedId);
  if (!selected) return position;
  const group = lifecycleOf(selected);
  const target = mapPositionFor(
    branches.filter((branch) => lifecycleOf(branch) === group),
    selected.id,
  )!;
  const previous = position.maps[group];
  const samePage = previous?.expanded === target.expanded && previous?.page === target.page;
  return { ...position, group, maps: { ...position.maps, [group]: samePage ? previous : target } };
}

/** Keep the same visible branch when a refresh inserts/reorders preceding rows. */
export function anchoredScroll(branches: Branch[], position: InventoryPosition): number {
  const index = branches.findIndex((branch) => branch.id === position.anchorId);
  return index < 0 ? position.top : index * INVENTORY_ROW_HEIGHT + (position.anchorOffset ?? 0);
}
export function inventoryCursor(
  key: string,
  index: number,
  count: number,
  height: number,
): number | undefined {
  if (!count) return;
  const page = Math.max(1, Math.floor((height - INVENTORY_HEADER_HEIGHT) / INVENTORY_ROW_HEIGHT));
  const next =
    key === 'Home'
      ? 0
      : key === 'End'
        ? count - 1
        : key === 'ArrowDown'
          ? index + 1
          : key === 'ArrowUp'
            ? index - 1
            : key === 'PageDown'
              ? index + page
              : key === 'PageUp'
                ? index - page
                : undefined;
  return next === undefined ? undefined : Math.max(0, Math.min(count - 1, next));
}
export function typeaheadIndex(branches: Branch[], text: string, current: number): number {
  const needle = text.toLocaleLowerCase();
  for (let offset = 1; offset <= branches.length; offset++) {
    const index = (current + offset) % branches.length;
    if (
      branches[index].title.toLocaleLowerCase().startsWith(needle) ||
      branches[index].name.toLocaleLowerCase().startsWith(needle)
    )
      return index;
  }
  return current;
}
