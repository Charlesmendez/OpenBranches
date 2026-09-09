import { agentSearchText } from '../../domain/agents';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Branch } from '../../domain/types';
import { lifecycleOf } from '../../domain/branches';
import {
  anchoredScroll,
  initialInventory,
  inventoryCursor,
  typeaheadIndex,
  INVENTORY_HEADER_HEIGHT as HEADER,
  INVENTORY_ROW_HEIGHT as ROW,
  type InventoryPosition,
} from '../navigation';

export function useInventoryNavigation(
  branches: Branch[],
  selectedId: string | null,
  initial: InventoryPosition | undefined,
  remember: (position: InventoryPosition) => void,
  onSelect: (branch: Branch) => void,
) {
  const [position, setPosition] = useState(initial ?? initialInventory);
  const [height, setHeight] = useState(550);
  const current = useRef(position);
  const save = useRef(remember);
  save.current = remember;
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const first = useRef(true);
  const lastSelected = useRef(selectedId);
  const focusing = useRef(false);
  const typed = useRef({ text: '', at: 0 });
  const update = (patch: Partial<InventoryPosition>) => {
    current.current = { ...current.current, ...patch };
    setPosition(current.current);
    save.current(current.current);
  };
  const filtered = useMemo(() => {
    const needle = position.query.toLocaleLowerCase().trim();
    return branches
      .filter(
        (branch) =>
          (!needle ||
            [branch.name, branch.title, agentSearchText(branch)].some((value) =>
              value.toLocaleLowerCase().includes(needle),
            )) &&
          (position.location === 'all' ||
            (position.location === 'local' && (branch.local || branch.detached)) ||
            (position.location === 'remote' && branch.remote)) &&
          (position.lifecycle === 'all' || lifecycleOf(branch) === position.lifecycle),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }, [branches, position.query, position.location, position.lifecycle]);
  const selectedIndex = filtered.findIndex((branch) => branch.id === selectedId);
  const savedIndex = filtered.findIndex((branch) => branch.id === position.activeId);
  const activeIndex =
    savedIndex >= 0
      ? savedIndex
      : selectedIndex >= 0
        ? selectedIndex
        : Math.min(filtered.length - 1, Math.floor(position.top / ROW));
  const active = filtered[activeIndex];
  const rowId = (index: number) => `${id}-branch-${index}`;
  const recordScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const index = Math.min(filtered.length - 1, Math.floor(element.scrollTop / ROW));
    update({
      top: element.scrollTop,
      left: element.scrollLeft,
      anchorId: filtered[index]?.id,
      anchorOffset: element.scrollTop - Math.max(0, index) * ROW,
    });
  };
  const reveal = (index: number, center = false) => {
    const element = scrollRef.current;
    if (!element || index < 0) return;
    const available = element.clientHeight - HEADER;
    const top = index * ROW;
    if (center) element.scrollTop = Math.max(0, top - (available - ROW) / 2);
    else if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW > element.scrollTop + available) element.scrollTop = top + ROW - available;
    recordScroll();
  };
  const focusList = (index = activeIndex) => {
    if (filtered[index]) update({ activeId: filtered[index].id });
    focusing.current = true;
    scrollRef.current?.focus({ preventScroll: true });
    focusing.current = false;
    reveal(index);
  };
  const select = (index: number) => {
    if (!filtered[index]) return;
    focusList(index);
    onSelect(filtered[index]);
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = anchoredScroll(filtered, current.current);
    element.scrollLeft = current.current.left;
    if (first.current && !initial && selectedIndex >= 0) {
      reveal(selectedIndex, true);
      focusList(selectedIndex);
    } else recordScroll();
    first.current = false;
  }, [filtered]);
  useLayoutEffect(() => {
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    if (selectedIndex >= 0) {
      update({ activeId: selectedId! });
      reveal(selectedIndex);
    }
  }, [selectedId]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const filter = (patch: Partial<Pick<InventoryPosition, 'query' | 'location' | 'lifecycle'>>) => {
    typed.current = { text: '', at: 0 };
    update({ ...patch, top: 0, anchorId: undefined, anchorOffset: undefined, activeId: undefined });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.nativeEvent.isComposing || event.isDefaultPrevented()) return;
    if ((event.metaKey || event.ctrlKey) && !['Home', 'End'].includes(event.key)) return;
    const next = inventoryCursor(event.key, activeIndex, filtered.length, height);
    if (next !== undefined) {
      event.preventDefault();
      update({ activeId: filtered[next].id });
      reveal(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(activeIndex);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      scrollRef.current?.scrollBy({ left: event.key === 'ArrowRight' ? 140 : -140 });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      const repeat = typed.current.text.toLocaleLowerCase() === event.key.toLocaleLowerCase();
      const text =
        Date.now() - typed.current.at < 700 && !repeat ? typed.current.text + event.key : event.key;
      typed.current = { text, at: Date.now() };
      const match = typeaheadIndex(filtered, text, activeIndex);
      if (filtered[match]) {
        update({ activeId: filtered[match].id });
        reveal(match);
      }
    }
  };
  const start = Math.max(0, Math.floor(position.top / ROW) - 3);
  const end = Math.min(filtered.length, Math.ceil((position.top + height - HEADER) / ROW) + 3);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  // Keep the active descendant mounted when pointer scrolling moves it outside
  // the window. At most one extra option is needed; focus never lands on body.
  if (active && !indices.includes(activeIndex)) indices.push(activeIndex);
  indices.sort((a, b) => a - b);
  return {
    helpId: `${id}-help`,
    position,
    filtered,
    scrollRef,
    active,
    rowId,
    activeIndex,
    indices,
    filter,
    recordScroll,
    onKeyDown,
    select,
    focusList,
    onFocus: () => {
      if (!focusing.current) focusList(selectedIndex >= 0 ? selectedIndex : activeIndex);
    },
  };
}
