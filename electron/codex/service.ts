import { mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
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
import { associateTask, createCodexTaskLinker } from './associations';
import { readCodexAccount } from './account';
import { createCodexActivitySource, type CodexActivitySource } from './activity';

const emptyIndex = (): CodexIndex => ({ tasks: [], checkedAt: '', partial: false });
// Saved history is not a live signal. Keep it within the five-minute freshness
// budget without launching a full inspection on every live-daemon heartbeat.
const HISTORY_REFRESH_MS = 4 * 60_000;
// Heartbeats keep live labels fresh without rebuilding the workspace for every
// log write. State/checkout changes and evidence expiry still publish immediately.
const LIVE_HEARTBEAT_PUBLISH_MS = 30_000;
type DiscoveryClient = Pick<CodexInspectionClient, 'initialize' | 'request' | 'close'>;
interface Dependencies {
  find: () => Promise<CodexExecutable | undefined>;
  launch: (executable: string, cwd: string) => DiscoveryClient;
  read: (client: DiscoveryClient) => Promise<CodexIndex>;
  launchLive?: (executable: string, cwd: string) => DiscoveryClient;
  activity?: CodexActivitySource;
}

const defaultDependencies = (): Dependencies => ({
  find: findCodex,
  launch: CodexInspectionClient.launch,
  read: readTaskIndex,
  launchLive: CodexInspectionClient.launchLive,
  activity: createCodexActivitySource(),
});

export class CodexService {
  private index: CodexIndex;
  private statusValue: CodexStatus;
  private closed = false;
  private generation = 0;
  private job?: { generation: number; promise: Promise<void> };
  private client?: DiscoveryClient;
  private detection?: Promise<CodexExecutable | undefined>;
  private timer?: ReturnType<typeof setInterval>;
  private liveTimer?: ReturnType<typeof setInterval>;
  private suspended = false;
  private liveTasks: CodexTask[] = [];
  private liveClient?: DiscoveryClient;
  private liveJob?: Promise<void>;
  private liveDaemonRequested = false;
  private dependencies: Dependencies;
  private lastIndexAttempt = Number.NEGATIVE_INFINITY;
  private liveEvidence = '';
  private lastLivePublication = Number.NEGATIVE_INFINITY;
  private pendingLiveHeartbeat = false;

  constructor(
    private store: Pick<AppStore, 'read' | 'write'>,
    private directory: string,
    private current: () => Snapshot,
    private publish: () => void,
    dependencies?: Dependencies,
  ) {
    this.dependencies = dependencies ?? defaultDependencies();
    const enabled = store.read<boolean>('codex.enabled', false) === true;
    const cached = indexSchema.safeParse(store.read('codex.index', null));
    this.index = enabled && cached.success ? cached.data : emptyIndex();
    this.statusValue = { installed: false, enabled, state: 'not-connected' };
    this.startPolling();
  }

  status(linked?: Snapshot): CodexStatus {
    const eligible = new Set([...this.index.tasks, ...this.liveTasks].map((task) => task.id));
    const ids = new Set(
      (eligible.size ? (linked ?? this.enrich(this.current())).repositories : []).flatMap((r) =>
        r.branches.flatMap(
          (b) =>
            b.tasks?.filter((t) => t.tool === 'codex' && eligible.has(t.id)).map((t) => t.id) ?? [],
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
    this.liveEvidence = '';
    this.pendingLiveHeartbeat = false;
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
    const link = createCodexTaskLinker(
      [
        ...new Map(
          [...this.index.tasks, ...this.liveTasks].map((task) => [task.id, task]),
        ).values(),
      ],
      this.index.checkedAt,
    );
    return {
      ...snapshot,
      repositories: snapshot.repositories.map(link),
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
    const index = this.selectIndex(snapshot, this.index).index;
    this.store.write('codex.index', index);
    return () => {
      ++this.generation;
      this.client?.close();
      this.client = undefined;
      this.index = index;
      this.liveTasks = [];
      this.liveEvidence = '';
      this.pendingLiveHeartbeat = false;
      this.liveClient?.close();
      if (this.statusValue.state === 'connecting')
        this.statusValue = {
          ...this.statusValue,
          state: index.checkedAt ? 'ready' : 'not-connected',
        };
    };
  }

  private selectIndex(snapshot: Snapshot, index: CodexIndex) {
    const linked =
      this.statusValue.enabled && index.tasks.length
        ? snapshot.repositories.map(createCodexTaskLinker(index.tasks, index.checkedAt))
        : [];
    const evidence = linked.flatMap((repository) =>
      repository.branches.flatMap((branch) => {
        const tasks = branch.tasks?.filter((task) => task.tool === 'codex') ?? [];
        return tasks.length ? [{ branchId: branch.id, tasks }] : [];
      }),
    );
    const ids = new Set(evidence.flatMap((item) => item.tasks.map((task) => task.id)));
    return { index: { ...index, tasks: index.tasks.filter((task) => ids.has(task.id)) }, evidence };
  }

  refresh(): Promise<void> {
    if (this.closed || this.suspended || !this.statusValue.enabled) return Promise.resolve();
    void this.refreshLive();
    if (this.job?.generation === this.generation) return this.job.promise;
    const job = { generation: this.generation, promise: Promise.resolve() };
    this.job = job;
    job.promise = this.refreshIndex(job.generation).finally(() => {
      if (this.job === job) this.job = undefined;
    });
    return job.promise;
  }

  refreshIfStale(): Promise<void> {
    const elapsed = Date.now() - this.lastIndexAttempt;
    return this.statusValue.state !== 'ready' || elapsed < 0 || elapsed >= HISTORY_REFRESH_MS
      ? this.refresh()
      : this.refreshLive();
  }

  refreshLive(includeDaemon = true): Promise<void> {
    if (
      this.closed ||
      this.suspended ||
      !this.statusValue.enabled ||
      (!this.dependencies.launchLive && !this.dependencies.activity)
    )
      return Promise.resolve();
    if (this.dependencies.launchLive && (includeDaemon || !this.dependencies.activity))
      this.liveDaemonRequested = true;
    if (this.liveJob) return this.liveJob;
    const generation = this.generation;
    const valid = () =>
      !this.closed && !this.suspended && this.statusValue.enabled && generation === this.generation;
    this.liveJob = (async () => {
      do {
        const readDaemon = this.liveDaemonRequested;
        this.liveDaemonRequested = false;
        await this.readLiveSources(valid, readDaemon);
      } while (valid() && this.liveDaemonRequested);
    })().finally(() => {
      this.liveJob = undefined;
    });
    return this.liveJob;
  }

  private async readLiveSources(valid: () => boolean, includeDaemon: boolean) {
    const activity = this.dependencies.activity
      ? this.dependencies.activity.read(this.index.tasks)
      : undefined;
    const daemon =
      includeDaemon && this.dependencies.launchLive ? this.readDaemonLive(valid) : undefined;
    const [activityResult, daemonResult] = await Promise.allSettled([
      activity ?? Promise.reject(new Error('Activity log source unavailable')),
      daemon ?? Promise.reject(new Error('Codex daemon unavailable')),
    ]);
    if (!valid()) return;
    const available = [daemonResult, activityResult].flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const previousTasks = this.liveTasks;
    const previousState = this.statusValue.liveState;
    const previousEvidence = this.liveEvidence;
    if (available.length) {
      const live = mergeLiveIndexes(available);
      const selection = live.tasks.length
        ? this.selectIndex(this.current(), live)
        : { index: live, evidence: [] };
      const selected = selection.index;
      // Compare meaningful derived evidence separately from heartbeat timestamps.
      // A checkout switch or expired observation must never wait for the batch.
      this.liveEvidence = JSON.stringify(
        selection.evidence.map(({ branchId, tasks }) => ({
          branchId,
          tasks: tasks
            .map(({ checkedAt: _checkedAt, updatedAt: _updatedAt, ...task }) => task)
            .sort((a, b) => a.id.localeCompare(b.id)),
        })),
      );
      this.liveTasks = isDeepStrictEqual(previousTasks, selected.tasks)
        ? previousTasks
        : selected.tasks;
      this.statusValue = {
        ...this.statusValue,
        liveState: live.partial ? 'partial' : 'connected',
        liveCheckedAt: live.checkedAt,
      };
    } else {
      this.liveTasks = [];
      this.liveEvidence = '';
      this.statusValue = { ...this.statusValue, liveState: 'unavailable' };
    }
    const tasksChanged = !isDeepStrictEqual(previousTasks, this.liveTasks);
    this.pendingLiveHeartbeat ||= tasksChanged;
    const elapsed = Date.now() - this.lastLivePublication;
    if (
      previousState !== this.statusValue.liveState ||
      previousEvidence !== this.liveEvidence ||
      (tasksChanged &&
        !isDeepStrictEqual(liveTaskMeanings(previousTasks), liveTaskMeanings(this.liveTasks))) ||
      (this.pendingLiveHeartbeat && (elapsed < 0 || elapsed >= LIVE_HEARTBEAT_PUBLISH_MS))
    ) {
      this.lastLivePublication = Date.now();
      this.pendingLiveHeartbeat = false;
      this.publish();
    }
  }

  setSuspended(suspended: boolean): void {
    if (this.closed || suspended === this.suspended) return;
    this.suspended = suspended;
    this.dependencies.activity?.setSuspended?.(suspended);
    if (suspended) {
      ++this.generation;
      this.liveDaemonRequested = false;
      this.stopPolling();
      this.client?.close();
      this.client = undefined;
      this.liveClient?.close();
      this.liveClient = undefined;
    } else {
      this.lastLivePublication = Number.NEGATIVE_INFINITY;
      this.startPolling();
    }
  }

  private startPolling() {
    if (this.closed || this.suspended || this.timer || this.liveTimer) return;
    this.timer = setInterval(() => {
      void this.refreshIfStale();
    }, 60_000);
    // Local rollout files are already watched. This short pass only consumes
    // changed file tails; the heavier daemon inspection runs on the minute pass.
    this.liveTimer = setInterval(() => {
      void this.refreshLive(false);
    }, 5_000);
    this.timer.unref?.();
    this.liveTimer.unref?.();
  }

  private stopPolling() {
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.timer = undefined;
    this.liveTimer = undefined;
  }

  private async readDaemonLive(valid: () => boolean) {
    let client: DiscoveryClient | undefined;
    try {
      const executable = await this.detect();
      if (!valid() || !executable?.supported) throw new Error('Codex daemon unavailable');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!valid()) throw new Error('Codex connection changed');
      client = this.dependencies.launchLive!(executable.path, this.directory);
      this.liveClient = client;
      await client.initialize();
      return await readLiveTasks(client);
    } finally {
      client?.close();
      if (this.liveClient === client) this.liveClient = undefined;
    }
  }

  private async refreshIndex(generation: number) {
    this.lastIndexAttempt = Date.now();
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
      const index = this.selectIndex(this.current(), fresh).index;
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
    this.stopPolling();
    this.client?.close();
    this.liveClient?.close();
    this.dependencies.activity?.close();
  }
}

function liveTaskMeanings(tasks: CodexTask[]) {
  return tasks
    .map(({ updatedAt: _updatedAt, runtime, ...metadata }) => ({
      ...metadata,
      runtime: runtime && { state: runtime.state, source: runtime.source },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function mergeLiveIndexes(indexes: CodexIndex[]): CodexIndex {
  const tasks = new Map<string, CodexTask>();
  for (const index of indexes)
    for (const task of index.tasks) {
      const previous = tasks.get(task.id);
      tasks.set(task.id, previous ? mergeLiveTask(previous, task) : task);
    }
  const checkedAt = indexes
    .map((index) => index.checkedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return {
    tasks: [...tasks.values()],
    checkedAt,
    partial: indexes.some((index) => index.partial),
  };
}

function mergeLiveTask(previous: CodexTask, next: CodexTask): CodexTask {
  return {
    ...previous,
    ...next,
    name: next.name ?? previous.name,
    gitInfo: next.gitInfo ?? previous.gitInfo,
    model: next.model ?? previous.model,
  };
}
