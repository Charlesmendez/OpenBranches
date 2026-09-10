import { peoplePosition, type PeoplePosition } from './peopleNavigation';
import { activityPosition, type ActivityPosition } from './activityNavigation';
import type { Lifecycle, View } from '../domain/types';
import type { MapPosition, ProjectPosition } from './navigation';

export type WorkspaceMode = 'live' | 'demo';
export interface WorkspacePosition {
  projectId: string | null;
  view: View;
  people?: PeoplePosition;
  activity?: ActivityPosition;
}
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>;
export const NAVIGATION_STORAGE_KEY = 'ob-navigation-v1';
const MAX_CHARACTERS = 2 * 1024 * 1024;
const MAX_PROJECTS = 100;
const lifecycles: Lifecycle[] = ['active', 'integrated', 'quiet', 'unverified'];
const views: View[] = ['map', 'inventory', 'people', 'attention', 'activity', 'settings'];
const modes: WorkspaceMode[] = ['live', 'demo'];
const emptyProject = (): ProjectPosition => ({ selectedId: null, group: 'active', maps: {} });
const emptyWorkspace = (): WorkspacePosition => ({ projectId: null, view: 'map' });
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : undefined;
const option = <T extends string | null>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const number = (value: unknown, min: number, max: number, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
function mapPosition(value: unknown): MapPosition | undefined {
  if (!record(value)) return;
  const result: MapPosition = {
    expanded: option(value.expanded, ['review', 'local', 'tracked', null], null),
    page: Math.floor(number(value.page, 0, 100_000)),
    ...(value.source === 'github' ? { source: 'github' as const } : {}),
  };
  if (record(value.viewport)) {
    const { x, y, zoom } = value.viewport;
    if (
      finite(x) &&
      finite(y) &&
      finite(zoom) &&
      Math.abs(x) <= 10_000_000 &&
      Math.abs(y) <= 10_000_000 &&
      zoom >= 0.05 &&
      zoom <= 4
    )
      result.viewport = { x, y, zoom };
  }
  return result;
}
function projectPosition(value: unknown): ProjectPosition {
  if (!record(value)) return emptyProject();
  const result: ProjectPosition = {
    selectedId: id(value.selectedId) ?? null,
    group: option(value.group, lifecycles, 'active'),
    maps: {},
  };
  if (record(value.maps))
    for (const group of lifecycles) {
      const position = mapPosition(value.maps[group]);
      if (position) result.maps[group] = position;
    }
  if (record(value.inventory)) {
    const inventory = value.inventory;
    result.inventory = {
      query:
        typeof inventory.query === 'string' && inventory.query.length <= 2048
          ? inventory.query
          : '',
      location: option(inventory.location, ['local', 'remote', 'all'], 'all'),
      lifecycle: option(inventory.lifecycle, lifecycles, 'all'),
      top: number(inventory.top, 0, 100_000_000),
      left: number(inventory.left, 0, 100_000_000),
      anchorId: id(inventory.anchorId),
      anchorOffset: number(inventory.anchorOffset, 0, 100_000_000),
      activeId: id(inventory.activeId),
    };
  }
  return result;
}

/** Local UI preferences only. Git/provider evidence remains in the main-process
 * store. Writes are coalesced; failed persistence never blocks navigation. */
export class NavigationMemory {
  private mode: WorkspaceMode = 'live';
  private routes: Record<WorkspaceMode, WorkspacePosition> = {
    live: emptyWorkspace(),
    demo: emptyWorkspace(),
  };
  private projects: Record<WorkspaceMode, Map<string, ProjectPosition>> = {
    live: new Map(),
    demo: new Map(),
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private notice: string | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly storage: StorageAccess) {
    try {
      const text = storage().getItem(NAVIGATION_STORAGE_KEY);
      if (!text) return;
      if (text.length > MAX_CHARACTERS) throw new Error('Oversized view preferences');
      const saved: unknown = JSON.parse(text);
      if (
        !record(saved) ||
        saved.version !== 1 ||
        !record(saved.workspaces) ||
        !record(saved.projects)
      )
        throw new Error('Unrecognized view preferences');
      this.mode = saved.mode === 'demo' ? 'demo' : 'live';
      for (const mode of modes) {
        const route = saved.workspaces[mode];
        if (record(route))
          this.routes[mode] = {
            projectId: id(route.projectId) ?? null,
            view: option(route.view, views, 'map'),
            ...(route.people === undefined ? {} : { people: peoplePosition(route.people) }),
            ...(route.activity === undefined ? {} : { activity: activityPosition(route.activity) }),
          };
        const entries = saved.projects[mode];
        if (Array.isArray(entries))
          for (const entry of entries.slice(-MAX_PROJECTS)) {
            if (record(entry) && id(entry.id))
              this.projects[mode].set(entry.id as string, projectPosition(entry.position));
          }
      }
    } catch {
      this.notice = 'Your saved view could not be restored. You can keep working.';
    }
  }
  initialMode(desktop: boolean): WorkspaceMode {
    return desktop ? this.mode : 'demo';
  }
  workspace(mode: WorkspaceMode): WorkspacePosition {
    return this.routes[mode];
  }
  read(mode: WorkspaceMode, projectId: string): ProjectPosition {
    return this.projects[mode].get(projectId) ?? emptyProject();
  }
  remember(mode: WorkspaceMode, projectId: string, patch: Partial<ProjectPosition>): void {
    const previous = this.read(mode, projectId);
    const next = { ...previous, ...patch };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    this.projects[mode].delete(projectId);
    this.projects[mode].set(projectId, next);
    while (this.projects[mode].size > MAX_PROJECTS)
      this.projects[mode].delete(this.projects[mode].keys().next().value!);
    this.changed();
  }
  people(mode: WorkspaceMode): PeoplePosition {
    return peoplePosition(this.routes[mode].people);
  }
  rememberPeople(mode: WorkspaceMode, value: PeoplePosition): void {
    const people = peoplePosition(value);
    if (JSON.stringify(this.routes[mode].people) === JSON.stringify(people)) return;
    this.routes[mode] = { ...this.routes[mode], people };
    this.changed();
  }
  activity(mode: WorkspaceMode): ActivityPosition {
    return activityPosition(this.routes[mode].activity);
  }
  rememberActivity(mode: WorkspaceMode, value: ActivityPosition): void {
    const activity = activityPosition(value);
    if (JSON.stringify(this.routes[mode].activity) === JSON.stringify(activity)) return;
    this.routes[mode] = { ...this.routes[mode], activity };
    this.changed();
  }
  rememberWorkspace(mode: WorkspaceMode, position: WorkspacePosition): void {
    const old = this.routes[mode];
    if (this.mode === mode && old.projectId === position.projectId && old.view === position.view)
      return;
    this.mode = mode;
    this.routes[mode] = {
      ...position,
      ...(old.people ? { people: old.people } : {}),
      ...(old.activity ? { activity: old.activity } : {}),
    };
    const current = position.projectId && this.projects[mode].get(position.projectId);
    if (current && position.projectId) {
      this.projects[mode].delete(position.projectId);
      this.projects[mode].set(position.projectId, current);
    }
    this.changed();
  }
  prune(mode: WorkspaceMode, selected: Set<string>): void {
    let changed = false;
    for (const projectId of this.projects[mode].keys())
      if (!selected.has(projectId)) {
        this.projects[mode].delete(projectId);
        changed = true;
      }
    if (this.routes[mode].projectId && !selected.has(this.routes[mode].projectId!)) {
      this.routes[mode] = { ...this.routes[mode], projectId: null };
      changed = true;
    }
    if (changed) this.changed();
  }
  private changed(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, 250);
  }
  private report(notice: string | null): void {
    if (this.notice === notice) return;
    this.notice = notice;
    for (const listener of this.listeners) listener();
  }
  getNotice = () => this.notice;
  saveNow = (): void => {
    this.dirty = true;
    this.flush();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  flush = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    try {
      const text = JSON.stringify({
        version: 1,
        mode: this.mode,
        workspaces: this.routes,
        projects: Object.fromEntries(
          modes.map((mode) => [
            mode,
            [...this.projects[mode]].map(([id, position]) => ({ id, position })),
          ]),
        ),
      });
      if (text.length > MAX_CHARACTERS) throw new Error('Oversized view preferences');
      this.storage().setItem(NAVIGATION_STORAGE_KEY, text);
      this.dirty = false;
      this.report(null);
    } catch {
      this.report('Your place is kept for this session, but could not be saved for next time.');
    }
  };
}
