import { mkdir } from 'node:fs/promises';
import type { CodexStatus, OpenTaskCommand, Snapshot } from '../../src/domain/types';
import type { AppStore } from '../services/store';
import { findCodex, type CodexExecutable } from './executable';
import { CodexInspectionClient } from './transport';
import {
  indexSchema,
  readTaskIndex,
  readLiveTasks,
  type CodexIndex,
  type CodexTask,
} from './reader';
import { associateTask, linkRepository } from './associations';
import { readCodexAccount } from './account';

const emptyIndex = (): CodexIndex => ({ tasks: [], checkedAt: '', partial: false });
type DiscoveryClient = Pick<CodexInspectionClient, 'initialize' | 'request' | 'close'>;
interface Dependencies {
  find: () => Promise<CodexExecutable | undefined>;
  launch: (executable: string, cwd: string) => DiscoveryClient;
  read: (client: DiscoveryClient) => Promise<CodexIndex>;
  launchLive?: (executable: string, cwd: string) => DiscoveryClient;
}

export class CodexService {
  private index: CodexIndex;
  private statusValue: CodexStatus;
  private closed = false;
  private generation = 0;
  private job?: { generation: number; promise: Promise<void> };
  private client?: DiscoveryClient;
  private detection?: Promise<CodexExecutable | undefined>;
  private timer: ReturnType<typeof setInterval>;
  private liveTimer: ReturnType<typeof setInterval>;
  private liveTasks: CodexTask[] = [];
  private liveClient?: DiscoveryClient;
  private liveJob?: Promise<void>;

  constructor(
    private store: Pick<AppStore, 'read' | 'write'>,
    private directory: string,
    private current: () => Snapshot,
    private publish: () => void,
    private dependencies: Dependencies = {
      find: findCodex,
      launch: CodexInspectionClient.launch,
      read: readTaskIndex,
      launchLive: CodexInspectionClient.launchLive,
    },
  ) {
    const enabled = store.read<boolean>('codex.enabled', false) === true;
    const cached = indexSchema.safeParse(store.read('codex.index', null));
    this.index = enabled && cached.success ? cached.data : emptyIndex();
    this.statusValue = { installed: false, enabled, state: 'not-connected' };
    this.timer = setInterval(() => {
      void this.refresh();
    }, 60_000);
    this.liveTimer = setInterval(() => {
      void this.refreshLive();
    }, 15_000);
  }

  status(): CodexStatus {
    const ids = new Set(
      this.enrich(this.current()).repositories.flatMap((r) =>
        r.branches.flatMap(
          (b) => b.tasks?.filter((t) => t.tool === 'codex').map((t) => t.id) ?? [],
        ),
      ),
    );
    return {
      ...this.statusValue,
      checkedAt: this.index.checkedAt || undefined,
      partial: this.index.partial,
      taskCount: ids.size,
    };
  }

  async detect() {
    this.detection ??= this.dependencies.find();
    const executable = await this.detection;
    if (this.closed) return;
    this.statusValue = {
      ...this.statusValue,
      installed: !!executable,
      version: executable?.version,
      ...(!executable || !executable.supported ? { state: 'unavailable' as const } : {}),
    };
    return executable;
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.detection = undefined;
    this.statusValue = { ...this.statusValue, enabled: true };
    this.store.write('codex.enabled', true);
    void this.refreshLive();
    return this.refresh();
  }

  disconnect() {
    ++this.generation;
    this.client?.close();
    this.client = undefined;
    this.liveClient?.close();
    this.liveTasks = [];
    this.index = emptyIndex();
    this.statusValue = {
      installed: this.statusValue.installed,
      version: this.statusValue.version,
      enabled: false,
      state: 'not-connected',
    };
    this.store.write('codex.enabled', false);
    this.store.write('codex.index', null);
    this.publish();
  }

  enrich(snapshot: Snapshot): Snapshot {
    if (!this.statusValue.enabled) return snapshot;
    return {
      ...snapshot,
      repositories: snapshot.repositories.map((r) =>
        linkRepository(
          r,
          [
            ...new Map(
              [...this.index.tasks, ...this.liveTasks].map((task) => [task.id, task]),
            ).values(),
          ],
          this.index.checkedAt,
        ),
      ),
    };
  }

  isTaskLinked({ repositoryId, branchId, taskId }: OpenTaskCommand): boolean {
    if (this.closed || !this.statusValue.enabled) return false;
    const repository = this.current().repositories.find((r) => r.id === repositoryId);
    const branch = repository?.branches.find((b) => b.id === branchId);
    const task = [...this.liveTasks, ...this.index.tasks].find((t) => t.id === taskId);
    return !!(
      repository &&
      branch &&
      task &&
      associateTask(repository, branch, task, this.index.checkedAt)
    );
  }

  forgetUnselected() {
    this.prepareForgetUnselected(this.current())();
  }

  prepareForgetUnselected(snapshot: Snapshot): () => void {
    const index = this.selectedIndex(snapshot, this.index);
    this.store.write('codex.index', index);
    return () => {
      ++this.generation;
      this.client?.close();
      this.client = undefined;
      this.index = index;
      this.liveTasks = [];
      this.liveClient?.close();
      if (this.statusValue.state === 'connecting')
        this.statusValue = {
          ...this.statusValue,
          state: index.checkedAt ? 'ready' : 'not-connected',
        };
    };
  }

  private selectedIndex(snapshot: Snapshot, index: CodexIndex): CodexIndex {
    const linked = this.statusValue.enabled
      ? snapshot.repositories.map((repository) =>
          linkRepository(repository, index.tasks, index.checkedAt),
        )
      : [];
    const ids = new Set(
      linked.flatMap((r) =>
        r.branches.flatMap(
          (b) => b.tasks?.filter((t) => t.tool === 'codex').map((t) => t.id) ?? [],
        ),
      ),
    );
    return { ...index, tasks: index.tasks.filter((task) => ids.has(task.id)) };
  }

  refresh(): Promise<void> {
    if (this.closed || !this.statusValue.enabled) return Promise.resolve();
    void this.refreshLive();
    if (this.job?.generation === this.generation) return this.job.promise;
    const job = { generation: this.generation, promise: Promise.resolve() };
    this.job = job;
    job.promise = this.refreshIndex(job.generation).finally(() => {
      if (this.job === job) this.job = undefined;
    });
    return job.promise;
  }

  refreshLive(): Promise<void> {
    if (this.closed || !this.statusValue.enabled || !this.dependencies.launchLive)
      return Promise.resolve();
    if (this.liveJob) return this.liveJob;
    const generation = this.generation;
    const valid = () => !this.closed && this.statusValue.enabled && generation === this.generation;
    this.liveJob = (async () => {
      let client: DiscoveryClient | undefined;
      try {
        const executable = await this.detect();
        if (!valid() || !executable?.supported) return;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        if (!valid()) return;
        client = this.dependencies.launchLive!(executable.path, this.directory);
        this.liveClient = client;
        await client.initialize();
        const live = await readLiveTasks(client);
        if (!valid()) return;
        const selected = this.selectedIndex(this.current(), live);
        this.liveTasks = selected.tasks;
        this.statusValue = {
          ...this.statusValue,
          liveState: live.partial ? 'partial' : 'connected',
          liveCheckedAt: live.checkedAt,
        };
      } catch {
        if (valid()) {
          this.liveTasks = [];
          this.statusValue = { ...this.statusValue, liveState: 'unavailable' };
        }
      } finally {
        client?.close();
        if (this.liveClient === client) this.liveClient = undefined;
        if (valid()) this.publish();
      }
    })().finally(() => {
      this.liveJob = undefined;
    });
    return this.liveJob;
  }

  private async refreshIndex(generation: number) {
    const valid = () => !this.closed && this.statusValue.enabled && generation === this.generation;
    this.statusValue = { ...this.statusValue, state: 'connecting', error: undefined };
    this.publish();
    let client: DiscoveryClient | undefined;
    try {
      const executable = await this.detect();
      if (!valid()) return;
      if (!executable) throw new Error('Codex was not found. Install Codex, then reconnect.');
      if (!executable.supported)
        throw new Error('Update Codex to version 0.144.4 or later to connect task history.');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!valid()) return;
      client = this.dependencies.launch(executable.path, this.directory);
      this.client = client;
      await client.initialize();
      if (!valid()) return;
      const fresh = this.current().repositories.length
        ? await this.dependencies.read(client)
        : { tasks: [], checkedAt: new Date().toISOString(), partial: false };
      if (!valid()) return;
      const index = this.selectedIndex(this.current(), fresh);
      this.store.write('codex.index', index);
      this.index = index;
      this.statusValue = { ...this.statusValue, state: 'ready', error: undefined };
      const account = await readCodexAccount(client);
      if (valid()) this.statusValue = { ...this.statusValue, account };
    } catch (error) {
      if (!valid()) return;
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        error:
          error instanceof Error && error.name !== 'ZodError'
            ? error.message
            : 'Codex returned an unsupported task index. Update Codex and reconnect.',
      };
    } finally {
      client?.close();
      if (this.client === client) this.client = undefined;
      if (valid()) this.publish();
    }
  }

  close() {
    this.closed = true;
    ++this.generation;
    clearInterval(this.timer);
    clearInterval(this.liveTimer);
    this.client?.close();
    this.liveClient?.close();
  }
}
