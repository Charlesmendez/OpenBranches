import { z } from 'zod';
import type { ProjectDiscoveryState, Repository } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import { readCodexProjects } from './codexProjects';

const exclusionsSchema = z.array(z.string().min(1).max(4096)).max(10_000);
interface RepositorySink {
  add(path: string, accept: (repository: Repository) => boolean): Promise<Repository | null>;
  current(): { repositories: Repository[] };
}
export class ProjectDiscoveryService {
  private value: ProjectDiscoveryState;
  private excluded: Set<string>;
  private generation = 0;
  private closed = false;
  private job?: Promise<void>;
  private rerun = false;
  private offset = 0;
  private identities = new Map<string, string>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private store: Pick<AppStore, 'read' | 'readStrict' | 'write'>,
    private repositories: RepositorySink,
    private publish: (state: ProjectDiscoveryState) => void,
    private read = readCodexProjects,
  ) {
    let stored: unknown;
    try {
      const value = store.readStrict('discovery.excluded');
      stored = value === undefined ? [] : value;
    } catch {
      // A malformed JSON value or failed read must not erase removal choices.
      stored = null;
    }
    const saved = exclusionsSchema.safeParse(stored);
    this.excluded = new Set(saved.success ? saved.data : []);
    this.value = {
      enabled: saved.success && store.read<boolean>('discovery.codex.enabled', false) === true,
      scanning: false,
      projects: [],
      excludedCount: this.excluded.size,
      failedCount: 0,
      pendingCount: 0,
      recoveryNeeded: !saved.success,
    };
    this.timer = setInterval(() => {
      void this.refresh();
    }, 60_000);
  }
  state(): ProjectDiscoveryState {
    return this.value;
  }
  private emit() {
    if (!this.closed) this.publish(this.value);
  }
  setEnabled(enabled: boolean): Promise<void> {
    if (enabled && this.value.recoveryNeeded)
      throw new Error('Reset removed-project choices before following projects.');
    this.store.write('discovery.codex.enabled', enabled);
    ++this.generation;
    this.value = { ...this.value, enabled };
    this.emit();
    return this.refresh();
  }
  restore(): Promise<void> {
    const enabled = this.value.recoveryNeeded
      ? this.store.read<boolean>('discovery.codex.enabled', false) === true
      : this.value.enabled;
    this.store.write('discovery.excluded', []);
    ++this.generation;
    this.excluded = new Set();
    this.value = { ...this.value, enabled, excludedCount: 0, recoveryNeeded: false };
    this.emit();
    return this.refresh();
  }
  // Called inside the existing stop-monitoring transaction. Late discoveries
  // check this set immediately before adoption and cannot recreate the project.
  prepareExclude(id: string): () => void {
    if (this.value.recoveryNeeded)
      throw new Error(
        'Removed-project choices are unavailable. Reset them in project discovery before removing a project.',
      );
    const excluded = new Set(this.excluded).add(id);
    exclusionsSchema.parse([...excluded]);
    this.store.write('discovery.excluded', [...excluded]);
    return () => {
      this.excluded = excluded;
      this.value = { ...this.value, excludedCount: excluded.size };
      this.emit();
    };
  }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.job) {
      this.rerun = true;
      return this.job;
    }
    this.job = this.run().finally(() => {
      this.job = undefined;
      if (this.rerun && !this.closed) {
        this.rerun = false;
        void this.refresh();
      }
    });
    return this.job;
  }
  private async run() {
    const generation = this.generation;
    const current = () => !this.closed && generation === this.generation;
    this.value = { ...this.value, scanning: true, error: undefined };
    this.emit();
    try {
      const projects = await this.read();
      if (!current()) return;
      const paths = new Set(projects.map((project) => project.path));
      this.identities = new Map([...this.identities].filter(([path]) => paths.has(path)));
      this.value = {
        ...this.value,
        projects,
        checkedAt: new Date().toISOString(),
        failedCount: 0,
        pendingCount: 0,
      };
      this.emit();
      if (!this.value.enabled) return;
      let failedCount = 0;
      const startedAt = Date.now();
      const visited = new Set<string>();
      let attempts = 0;
      const offset = this.offset % Math.max(1, projects.length);
      const monitored = (path: string) =>
        this.repositories
          .current()
          .repositories.some(
            (repository) =>
              repository.path === path || repository.worktrees.some((tree) => tree.path === path),
          );
      const excluded = (path: string) => this.excluded.has(this.identities.get(path) ?? '');
      for (const project of [...projects.slice(offset), ...projects.slice(0, offset)]) {
        if (!current() || !this.value.enabled) break;
        if (attempts >= 24 || Date.now() - startedAt >= 30_000) break;
        this.offset++;
        visited.add(project.path);
        if (!project.available) {
          failedCount++;
          continue;
        }
        if (monitored(project.path) || excluded(project.path)) continue;
        attempts++;
        try {
          await this.repositories.add(project.path, (repository) => {
            if (current()) this.identities.set(project.path, repository.id);
            return current() && this.value.enabled && !this.excluded.has(repository.id);
          });
        } catch {
          failedCount++;
        }
      }
      if (current())
        this.value = {
          ...this.value,
          failedCount,
          pendingCount: projects.filter(
            (project) =>
              project.available &&
              !visited.has(project.path) &&
              !monitored(project.path) &&
              !excluded(project.path),
          ).length,
        };
    } catch {
      if (current())
        this.value = {
          ...this.value,
          error:
            'Could not refresh Codex projects. Saved projects stay monitored; try again or add a folder.',
        };
    } finally {
      if (!this.closed) {
        this.value = { ...this.value, scanning: false };
        this.emit();
      }
    }
  }
  close() {
    this.closed = true;
    ++this.generation;
    clearInterval(this.timer);
  }
}
