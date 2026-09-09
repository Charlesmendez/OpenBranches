import { z } from 'zod';
import type { CodexInspectionClient } from './transport';
import { githubRepository } from '../../src/github/reader';

const timestamp = z.number().int().min(0).max(253402300799);
export const threadSchema = z.object({
  id: z.string().min(1).max(200),
  cwd: z.string().min(1).max(16384),
  name: z.string().max(4096).nullish(),
  createdAt: timestamp,
  updatedAt: timestamp,
  gitInfo: z
    .object({
      branch: z.string().max(4096).nullish(),
      sha: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/i)
        .nullish(),
      originUrl: z
        .string()
        .max(16384)
        .nullish()
        .transform((value) => {
          // Only repository identity is needed; never retain URL credentials or query strings.
          const slug = value && githubRepository(value);
          return slug ? `https://github.com/${slug.toLowerCase()}` : undefined;
        })
        .optional(),
    })
    .nullish(),
});
export type CodexTask = z.infer<typeof threadSchema> & {
  archived: boolean;
  runtime?: { state: 'active' | 'idle' | 'waiting'; checkedAt: string };
};
const pageSchema = z.object({
  data: z.array(z.unknown()).max(100),
  nextCursor: z.string().max(16384).nullable(),
});
export interface CodexIndex {
  tasks: CodexTask[];
  checkedAt: string;
  partial: boolean;
}
export const indexSchema = z.object({
  tasks: z.array(threadSchema.extend({ archived: z.boolean() })).max(10000),
  checkedAt: z.string().datetime(),
  partial: z.boolean(),
});
export const sourceKinds = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown',
];

export async function readTaskIndex(
  client: Pick<CodexInspectionClient, 'request'>,
): Promise<CodexIndex> {
  const tasks = new Map<string, CodexTask>();
  let partial = false;
  const deadline = Date.now() + 60_000;
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 50; page++) {
      if (Date.now() >= deadline) {
        partial = true;
        break;
      }
      const response = pageSchema.parse(
        await client.request('thread/list', {
          archived,
          cursor,
          limit: 100,
          sortKey: 'updated_at',
          sortDirection: 'desc',
          sourceKinds,
          useStateDbOnly: true,
        }),
      );
      for (const item of response.data) {
        // Strip prompts, rollout paths, email, and any future protocol fields.
        const parsed = threadSchema.safeParse(item);
        if (!parsed.success) {
          partial = true;
          continue;
        }
        if (!tasks.has(parsed.data.id)) tasks.set(parsed.data.id, { ...parsed.data, archived });
      }
      cursor = response.nextCursor;
      if (!cursor) break;
      if (seen.has(cursor) || page === 49) {
        partial = true;
        break;
      }
      seen.add(cursor);
    }
  }
  return { tasks: [...tasks.values()], checkedAt: new Date().toISOString(), partial };
}

export async function readLiveTasks(
  client: Pick<CodexInspectionClient, 'request'>,
): Promise<CodexIndex> {
  const deadline = Date.now() + 12_000;
  const loaded = z
    .object({
      data: z.array(z.string().min(1).max(200)).max(200),
      nextCursor: z.string().nullable().optional(),
    })
    .parse(await client.request('thread/loaded/list', { limit: 100 }, 5000));
  const tasks: CodexTask[] = [];
  let partial = !!loaded.nextCursor || loaded.data.length > 100;
  for (let start = 0; start < Math.min(loaded.data.length, 100); start += 4) {
    if (Date.now() >= deadline) {
      partial = true;
      break;
    }
    const results = await Promise.allSettled(
      loaded.data.slice(start, start + 4).map(async (threadId) => {
        const response = z
          .object({
            thread: threadSchema.extend({
              status: z.object({
                type: z.enum(['active', 'idle', 'notLoaded', 'systemError']),
                activeFlags: z
                  .array(z.enum(['waitingOnApproval', 'waitingOnUserInput']))
                  .optional(),
              }),
            }),
          })
          .parse(await client.request('thread/read', { threadId, includeTurns: false }, 5000));
        const { status, ...task } = response.thread;
        if (task.id !== threadId || !['active', 'idle'].includes(status.type)) return;
        return {
          ...task,
          archived: false,
          runtime: {
            state:
              status.type === 'idle'
                ? ('idle' as const)
                : status.activeFlags?.length
                  ? ('waiting' as const)
                  : ('active' as const),
            checkedAt: new Date().toISOString(),
          },
        };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) tasks.push(result.value);
      else partial = true;
    }
  }
  return { tasks, partial, checkedAt: new Date().toISOString() };
}
