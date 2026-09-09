import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { AgentHistoryStatus, CodingTool, Repository, Snapshot } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import type { SavedAgentTask } from './types';
import { linkRepository } from './associations';

export interface AgentIndex {
  tasks: SavedAgentTask[];
  checkedAt: string;
  partial: boolean;
}
export interface HistorySource {
  tool: CodingTool;
  read(repositories: Repository[], signal?: AbortSignal): Promise<AgentIndex>;
}
const empty = (): AgentIndex => ({ tasks: [], checkedAt: '', partial: false });
const timestamp = z.number().min(0).max(253402300799);
function indexSchema(tool: CodingTool) {
  return z.object({
    tasks: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          tool: z.literal(tool),
          name: z.string().max(4096).nullish(),
          cwd: z
            .string()
            .max(16384)
            .refine((value) => isAbsolute(value) && !value.includes('\0')),
          updatedAt: timestamp,
          checkedAt: z.string().datetime().optional(),
          archived: z.boolean().optional(),
          model: z
            .object({
              id: z.string().min(1).max(200),
              provider: z.enum(['openai', 'anthropic', 'xai', 'other']).optional(),
            })
            .optional(),
          gitInfo: z
            .object({
              branch: z.string().max(4096).nullish(),
              sha: z
                .string()
                .regex(/^[a-f\d]{40,64}$/i)
                .nullish(),
            })
            .nullish(),
        }),
      )
      .max(1000),
    checkedAt: z.string().datetime(),
    partial: z.boolean(),
  });
}

// The source reads history; this service owns opt-in state, cache scope, and races.
// Additional local coding tools can supply the same metadata-only source interface.
export class LocalHistoryService {
  private index: AgentIndex;
  private value: AgentHistoryStatus;
  private generation = 0;
  private closed = false;
  private job?: { generation: number; controller: AbortController; promise: Promise<void> };
  private timer: ReturnType<typeof setInterval>;
  private prefix: string;
  constructor(
    private store: Pick<AppStore, 'read' | 'write' | 'transaction'>,
    private current: () => Snapshot,
    private publish: () => void,
    private source: HistorySource,
  ) {
    this.prefix = 'agents.' + source.tool;
    const enabled = store.read<boolean>(this.prefix + '.enabled', false) === true;
    const saved = indexSchema(source.tool).safeParse(store.read(this.prefix + '.index', null));
    this.index = enabled && saved.success ? this.selectedIndex(saved.data, current()) : empty();
    this.value = { tool: source.tool, enabled, state: 'not-connected' };
    this.timer = setInterval(() => {
      void this.refresh();
    }, 60_000);
  }
  status(): AgentHistoryStatus {
    return {
      ...this.value,
      checkedAt: this.index.checkedAt || undefined,
      partial: this.index.partial,
      taskCount: this.selectedIndex(this.index, this.current()).tasks.length,
    };
  }
  enrich(snapshot: Snapshot): Snapshot {
    if (!this.value.enabled) return snapshot;
    return {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) =>
        linkRepository(repository, this.index.tasks, this.index.checkedAt, this.source.tool),
      ),
    };
  }
  setEnabled(enabled: boolean): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.store.transaction(() => {
      this.store.write(this.prefix + '.enabled', enabled);
      if (!enabled) this.store.write(this.prefix + '.index', null);
    });
    ++this.generation;
    this.job?.controller.abort();
    this.value = { ...this.value, enabled, state: 'not-connected', error: undefined };
    if (!enabled) this.index = empty();
    this.publish();
    return this.refresh();
  }
  private selectedIndex(index: AgentIndex, snapshot: Snapshot): AgentIndex {
    const ids = new Set(
      snapshot.repositories.flatMap((repository) =>
        linkRepository(repository, index.tasks, index.checkedAt, this.source.tool).branches.flatMap(
          (branch) =>
            (branch.tasks ?? [])
              .filter((task) => task.tool === this.source.tool)
              .map((task) => task.id),
        ),
      ),
    );
    return { ...index, tasks: index.tasks.filter((task) => ids.has(task.id)) };
  }
  prepareForgetUnselected(snapshot: Snapshot): () => void {
    const next = this.selectedIndex(this.index, snapshot);
    this.store.write(this.prefix + '.index', next);
    return () => {
      ++this.generation;
      this.job?.controller.abort();
      this.index = next;
      this.value = { ...this.value, state: next.checkedAt ? 'ready' : 'not-connected' };
    };
  }
  refresh(): Promise<void> {
    if (this.closed || !this.value.enabled) return Promise.resolve();
    if (this.job?.generation === this.generation) return this.job.promise;
    const job = {
      generation: this.generation,
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    this.job = job;
    job.promise = this.read(job.generation, job.controller).finally(() => {
      if (this.job === job) this.job = undefined;
    });
    return job.promise;
  }
  private async read(generation: number, controller: AbortController) {
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let cancelRead!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancelRead = () => reject(new Error('History read cancelled'));
      signal.addEventListener('abort', cancelRead, { once: true });
    });
    const valid = () => !this.closed && this.value.enabled && generation === this.generation;
    this.value = { ...this.value, state: 'reading', error: undefined };
    this.publish();
    try {
      const snapshot = this.current();
      const fresh = snapshot.repositories.length
        ? await Promise.race([this.source.read(snapshot.repositories, signal), cancelled])
        : { tasks: [], checkedAt: new Date().toISOString(), partial: false };
      if (!valid()) return;
      const parsed = indexSchema(this.source.tool).parse(fresh);
      // A bounded/failed subset cannot prove older sessions disappeared. Retain
      // their own observation times, and replace only sessions seen this pass.
      const tasks = new Map(
        (parsed.partial ? this.index.tasks : []).map((task) => [
          task.id,
          { ...task, checkedAt: task.checkedAt ?? this.index.checkedAt },
        ]),
      );
      for (const task of parsed.tasks) tasks.set(task.id, { ...task, checkedAt: parsed.checkedAt });
      const next = this.selectedIndex(
        {
          ...parsed,
          tasks: [...tasks.values()],
        },
        this.current(),
      );
      next.tasks = next.tasks.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1000);
      this.store.write(this.prefix + '.index', next);
      this.index = next;
      this.value = { ...this.value, state: 'ready', error: undefined };
    } catch {
      if (valid())
        this.value = {
          ...this.value,
          state: 'error',
          error: signal.aborted
            ? 'Reading local session history timed out. Saved matches remain available. Try again.'
            : 'Could not read local session history. Saved matches remain available. Check the coding tool’s local history and try again.',
        };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancelRead);
      if (valid()) this.publish();
    }
  }
  close() {
    this.closed = true;
    ++this.generation;
    this.job?.controller.abort();
    clearInterval(this.timer);
  }
}
