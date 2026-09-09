import { randomUUID } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import type {
  AgentHandoff,
  HandoffPreview,
  HandoffProvider,
  HandoffProviderStatus,
  HandoffResult,
  HandoffState,
  Snapshot,
  TaskLink,
} from '../../src/domain/types';
import type { AppStore } from '../services/store';
import { createHandoffPreview, parseHandoffSelections } from './handoffPlan';
import { detectAgentTools, runAgent, type AgentTools } from './handoffRunners';

const providerSchema = z.enum(['codex', 'claude-code', 'cursor']);
const recordSchema = z
  .object({
    id: z.string().uuid(),
    provider: providerSchema,
    repositoryId: z.string().min(1).max(4096),
    repositoryName: z.string().min(1).max(4096),
    branchIds: z.array(z.string().min(1).max(4096)).min(1).max(5_000),
    branchNames: z.array(z.string().min(1).max(4096)).min(1).max(5_000),
    state: z.enum(['queued', 'running', 'completed', 'failed']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    externalTaskId: z.string().min(1).max(200).optional(),
    result: z.string().max(40_000).optional(),
    error: z.string().max(500).optional(),
  })
  .strict()
  .refine((record) => record.branchIds.length === record.branchNames.length);
const ledgerSchema = z
  .object({ version: z.literal(1), handoffs: z.array(recordSchema).max(250) })
  .strict();
const commandSchema = z
  .object({
    provider: providerSchema,
    selections: z.unknown(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

interface PendingPlan {
  recordId: string;
  provider: HandoffProvider;
  cwd: string;
  prompt: string;
}

const emptyProviders = (): HandoffProviderStatus[] => [
  { provider: 'codex', label: 'Codex', installed: false },
  { provider: 'claude-code', label: 'Claude', installed: false },
  { provider: 'cursor', label: 'Cursor', installed: false },
];

export class HandoffService {
  private stateValue: HandoffState;
  private tools: AgentTools = { paths: {}, statuses: emptyProviders() };
  private detection?: Promise<void>;
  private queue: PendingPlan[] = [];
  private running = new Map<string, ChildProcessWithoutNullStreams>();
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private store: Pick<AppStore, 'readStrict' | 'write'>,
    private current: () => Snapshot,
    private publish: (state: HandoffState) => void,
    private dependencies: {
      detect: typeof detectAgentTools;
      run: typeof runAgent;
    } = { detect: detectAgentTools, run: runAgent },
  ) {
    const parsed = ledgerSchema.safeParse(store.readStrict('handoffs.ledger'));
    const now = new Date().toISOString();
    const handoffs = parsed.success
      ? parsed.data.handoffs.map((record) =>
          record.state === 'queued' || record.state === 'running'
            ? {
                ...record,
                state: 'failed' as const,
                updatedAt: now,
                error: 'OpenBranches closed before this proposal finished. Send it again to retry.',
              }
            : record,
        )
      : [];
    this.stateValue = { providers: this.tools.statuses, handoffs };
    this.heartbeat = setInterval(() => {
      if (this.running.size || this.queue.length) this.publish(this.state());
    }, 30_000);
    this.heartbeat.unref();
    if (parsed.success && handoffs.some((record, index) => record !== parsed.data.handoffs[index]))
      try {
        this.persistHandoffs(handoffs);
      } catch {
        // Keep recovered status visible even if the database is temporarily unavailable.
      }
  }

  async start(): Promise<void> {
    if (this.closed) return;
    this.detection ??= this.dependencies
      .detect()
      .then((tools) => {
        if (this.closed) return;
        this.tools = tools;
        this.stateValue = { ...this.stateValue, providers: tools.statuses };
        this.publish(this.state());
      })
      .catch(() => {
        // Optional integrations remain unavailable until the next app launch.
      });
    await this.detection;
  }

  state(): HandoffState {
    return {
      providers: this.stateValue.providers.map((provider) => ({ ...provider })),
      handoffs: this.stateValue.handoffs.map((handoff) => ({
        ...handoff,
        branchIds: [...handoff.branchIds],
        branchNames: [...handoff.branchNames],
      })),
    };
  }

  async preview(input: unknown): Promise<HandoffPreview> {
    await this.start();
    return createHandoffPreview(this.current(), input, this.tools.statuses);
  }

  async send(input: unknown): Promise<HandoffResult> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return this.failure('This handoff could not be understood.');
    let selections;
    try {
      selections = parseHandoffSelections(parsed.data.selections);
    } catch {
      return this.failure('Choose at least one current branch.');
    }
    await this.start();
    const executable = this.tools.paths[parsed.data.provider];
    if (!executable)
      return this.failure(`${this.label(parsed.data.provider)} is not available on this Mac.`);
    let preview: HandoffPreview;
    try {
      preview = createHandoffPreview(this.current(), selections, this.tools.statuses);
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'The branch evidence changed.');
    }
    if (preview.revision !== parsed.data.revision)
      return this.failure(
        'The branch evidence changed. Review the updated handoff before sending.',
      );
    const selectedKeys = new Set(
      selections.map((selection) => `${selection.repositoryId}\u0000${selection.branchId}`),
    );
    if (
      this.stateValue.handoffs.some(
        (handoff) =>
          (handoff.state === 'queued' || handoff.state === 'running') &&
          handoff.branchIds.some((branchId) =>
            selectedKeys.has(`${handoff.repositoryId}\u0000${branchId}`),
          ),
      )
    )
      return this.failure(
        'At least one selected branch is already being investigated. Wait for that proposal or choose different branches.',
      );
    if (preview.plans.length > 250)
      return this.failure('This selection spans too many projects. Send it in smaller groups.');
    const now = new Date().toISOString();
    const snapshot = this.current();
    const records = preview.plans.map<AgentHandoff>((plan) => ({
      id: randomUUID(),
      provider: parsed.data.provider,
      repositoryId: plan.repositoryId,
      repositoryName: plan.repositoryName,
      branchIds: plan.branches.map((branch) => branch.id),
      branchNames: plan.branches.map((branch) => branch.name),
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    }));
    const nextHandoffs = [...records, ...this.stateValue.handoffs].slice(0, 250);
    try {
      this.persistHandoffs(nextHandoffs);
    } catch {
      return this.failure('The handoff could not be saved. No agent task was started.');
    }
    this.stateValue = { ...this.stateValue, handoffs: nextHandoffs };
    for (const [index, plan] of preview.plans.entries()) {
      const repository = snapshot.repositories.find((item) => item.id === plan.repositoryId)!;
      this.queue.push({
        recordId: records[index].id,
        provider: parsed.data.provider,
        cwd: repository.path,
        prompt: plan.prompt,
      });
    }
    this.publish(this.state());
    this.pump();
    return {
      ok: true,
      state: this.state(),
      createdIds: records.map((record) => record.id),
    };
  }

  enrich(snapshot: Snapshot): Snapshot {
    if (!this.stateValue.handoffs.length) return snapshot;
    const records = this.stateValue.handoffs.filter((record) => record.state !== 'failed');
    return {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) => ({
        ...repository,
        branches: repository.branches.map((branch) => {
          const handoffs = records.filter(
            (record) =>
              record.repositoryId === repository.id && record.branchIds.includes(branch.id),
          );
          if (!handoffs.length) return branch;
          const existing = branch.tasks ?? [];
          const additions = handoffs.flatMap<TaskLink>((record) => {
            const id = record.externalTaskId ?? `openbranches-handoff-${record.id}`;
            if (existing.some((task) => task.id === id)) return [];
            const active = record.state === 'queued' || record.state === 'running';
            return [
              {
                id,
                tool: record.provider,
                title: `${this.label(record.provider)} branch review`,
                status: active ? 'active' : 'idle',
                association: 'verified',
                summary: record.result,
                updatedAt: record.updatedAt,
                checkedAt: active ? new Date().toISOString() : record.updatedAt,
                evidence: ['Sent from OpenBranches', `${record.branchIds.length} branch batch`],
              },
            ];
          });
          return additions.length ? { ...branch, tasks: [...existing, ...additions] } : branch;
        }),
      })),
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.queue = [];
    const now = new Date().toISOString();
    const running = new Set(this.running.keys());
    for (const child of this.running.values()) child.kill('SIGTERM');
    this.running.clear();
    if (running.size) {
      this.stateValue = {
        ...this.stateValue,
        handoffs: this.stateValue.handoffs.map((record) =>
          running.has(record.id)
            ? {
                ...record,
                state: 'failed',
                updatedAt: now,
                error: 'OpenBranches closed before this proposal finished. Send it again to retry.',
              }
            : record,
        ),
      };
      try {
        this.persistHandoffs(this.stateValue.handoffs);
      } catch {
        // App shutdown must continue even if the final status cannot be saved.
      }
    }
  }

  private pump() {
    while (!this.closed && this.running.size < 2 && this.queue.length) {
      const plan = this.queue.shift()!;
      const executable = this.tools.paths[plan.provider];
      if (!executable) {
        this.update(plan.recordId, {
          state: 'failed',
          error: `${this.label(plan.provider)} is no longer available on this Mac.`,
        });
        continue;
      }
      const record = this.update(plan.recordId, { state: 'running', error: undefined });
      if (!record) continue;
      try {
        const run = this.dependencies.run(plan.provider, executable, plan.cwd, plan.prompt);
        this.running.set(plan.recordId, run.child);
        void run.completion
          .then((result) => {
            if (!this.closed)
              this.update(plan.recordId, {
                state: 'completed',
                externalTaskId: result.externalTaskId,
                result: result.result,
                error: undefined,
              });
          })
          .catch((error) => {
            if (!this.closed)
              this.update(plan.recordId, {
                state: 'failed',
                error: error instanceof Error ? error.message : 'The agent task failed.',
              });
          })
          .finally(() => {
            this.running.delete(plan.recordId);
            this.pump();
          });
      } catch {
        this.update(plan.recordId, { state: 'failed', error: 'The agent could not be started.' });
      }
    }
  }

  private update(
    id: string,
    change: Partial<Pick<AgentHandoff, 'state' | 'externalTaskId' | 'result' | 'error'>>,
  ) {
    const index = this.stateValue.handoffs.findIndex((record) => record.id === id);
    if (index < 0) return;
    const record = {
      ...this.stateValue.handoffs[index],
      ...change,
      updatedAt: new Date().toISOString(),
    };
    const handoffs = [...this.stateValue.handoffs];
    handoffs[index] = record;
    try {
      this.persistHandoffs(handoffs);
      this.stateValue = { ...this.stateValue, handoffs };
    } catch {
      record.state = 'failed';
      record.error = 'OpenBranches could not save this task status.';
      this.stateValue = { ...this.stateValue, handoffs };
      this.publish(this.state());
      return;
    }
    this.publish(this.state());
    return record;
  }

  private persistHandoffs(handoffs: AgentHandoff[]) {
    const ledger = { version: 1 as const, handoffs };
    ledgerSchema.parse(ledger);
    this.store.write('handoffs.ledger', ledger);
  }

  private label(provider: HandoffProvider) {
    return (
      this.tools.statuses.find((item) => item.provider === provider)?.label ??
      (provider === 'codex' ? 'Codex' : provider === 'claude-code' ? 'Claude' : 'Cursor')
    );
  }

  private failure(error: string): HandoffResult {
    return { ok: false, state: this.state(), createdIds: [], error };
  }
}
