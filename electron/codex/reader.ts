import { z } from 'zod';
import type { CodexInspectionClient } from './transport';
import { githubRepository } from '../github/reader';

const timestamp = z.number().int().min(0).max(253402300799);
const threadSchema = z.object({
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
export type CodexTask = z.infer<typeof threadSchema> & { archived: boolean };
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
