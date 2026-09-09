import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Repository } from '../../src/domain/types';
import type { SavedAgentTask } from '../agents/types';
import type { HistorySource } from '../agents/history';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const recordSchema = z.object({
  type: z.string().max(100),
  sessionId: z.string().regex(uuid),
  isSidechain: z.boolean().optional(),
  cwd: z.string().max(16384).optional(),
  gitBranch: z.string().max(4096).optional(),
  timestamp: z.string().max(100).optional(),
  customTitle: z.string().max(4096).optional(),
  message: z.object({ model: z.string().max(200).optional() }).optional(),
});
export interface ClaudeIndex {
  tasks: SavedAgentTask[];
  checkedAt: string;
  partial: boolean;
  nextOffset?: number;
}
export const claudeDirectory = () =>
  process.env.CLAUDE_CONFIG_DIR && isAbsolute(process.env.CLAUDE_CONFIG_DIR)
    ? process.env.CLAUDE_CONFIG_DIR
    : join(homedir(), '.claude');
export const projectDirectoryName = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-');
const contextTypes = new Set(['user', 'assistant', 'system', 'attachment']);

// Retain structural metadata; discard message content, first prompts, and tool output.
// A transcript's latest recorded folder/branch is historical evidence, not ownership.
export function parseClaudeMetadata(
  chunks: string[],
  sessionId: string,
  paths: ReadonlyMap<string, string>,
  truncated = false,
): { task?: SavedAgentTask; partial: boolean } {
  let context: { cwd: string; branch: string; at: number } | undefined;
  let model: string | undefined;
  let title: string | undefined;
  let tailContext = false;
  let partial = truncated;
  for (let index = 0; index < chunks.length; index++) {
    for (const line of chunks[index].split('\n')) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        partial = true;
        continue;
      }
      const parsed = recordSchema.safeParse(value);
      if (!parsed.success) continue; // Non-session records and future types are not evidence.
      const record = parsed.data;
      if (record.sessionId !== sessionId || record.isSidechain) continue;
      if (record.type === 'custom-title' && record.customTitle?.trim())
        title = record.customTitle.trim();
      if (
        !contextTypes.has(record.type) ||
        record.cwd === undefined ||
        record.gitBranch === undefined
      )
        continue;
      const at = Date.parse(record.timestamp ?? '');
      const cwd =
        isAbsolute(record.cwd) && !record.cwd.includes('\0')
          ? paths.get(resolve(record.cwd))
          : undefined;
      if (
        !cwd ||
        !record.gitBranch ||
        record.gitBranch === 'HEAD' ||
        !Number.isFinite(at) ||
        at < 0 ||
        at > 253402300799000
      ) {
        context = undefined;
        model = undefined;
        continue;
      }
      if (context?.cwd !== cwd || context.branch !== record.gitBranch) model = undefined;
      context = { cwd, branch: record.gitBranch, at };
      if (index === chunks.length - 1) tailContext = true;
      const reportedModel = record.type === 'assistant' ? record.message?.model : undefined;
      if (reportedModel && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(reportedModel))
        model = reportedModel;
    }
  }
  if (!context || (truncated && !tailContext)) return { partial: true };
  return {
    partial,
    task: {
      id: sessionId,
      tool: 'claude-code',
      cwd: context.cwd,
      name: title || 'Claude session on ' + context.branch,
      updatedAt: context.at / 1000,
      gitInfo: { branch: context.branch },
      ...(model ? { model: { id: model } } : {}),
    },
  };
}

const HALF = 128 * 1024;
async function readSession(path: string, sessionId: string, paths: ReadonlyMap<string, string>) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Unsupported session file');
    const truncated = info.size > HALF * 2;
    const chunks: string[] = [];
    for (const [position, length] of truncated
      ? [
          [0, HALF],
          [info.size - HALF, HALF],
        ]
      : [[0, info.size]]) {
      const buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const result = await file.read(buffer, offset, length - offset, position + offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      let text = buffer.subarray(0, offset).toString('utf8');
      if (truncated && position === 0) text = text.slice(0, text.lastIndexOf('\n') + 1);
      if (truncated && position > 0) text = text.slice(text.indexOf('\n') + 1);
      chunks.push(text);
    }
    return parseClaudeMetadata(chunks, sessionId, paths, truncated);
  } finally {
    await file.close();
  }
}

export async function readClaudeIndex(
  repositories: Repository[],
  directory = claudeDirectory(),
  signal?: AbortSignal,
  startOffset = 0,
): Promise<ClaudeIndex> {
  const root = await realpath(join(directory, 'projects'));
  const paths = new Map<string, string>();
  const deadline = Date.now() + 20_000;
  let partial = false;
  for (const path of new Set(
    repositories.flatMap((repository) => [
      repository.path,
      ...repository.worktrees.map((tree) => tree.path),
    ]),
  )) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (paths.size >= 5000 || Date.now() >= deadline) {
      partial = true;
      break;
    }
    const normal = resolve(path);
    let canonical = normal;
    try {
      canonical = await realpath(normal);
    } catch {
      /* Missing worktrees can still have saved history. */
    }
    paths.set(normal, canonical);
    paths.set(canonical, canonical);
  }
  const tasks = new Map<string, SavedAgentTask>();
  const visited = new Set<string>();
  let bytes = 0;
  let files = 0;
  const allPaths = [...paths.keys()];
  const offset = Number.isFinite(startOffset)
    ? Math.abs(Math.trunc(startOffset)) % Math.max(1, allPaths.length)
    : 0;
  let nextOffset = offset;
  for (const path of [...allPaths.slice(offset), ...allPaths.slice(0, offset)]) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (Date.now() >= deadline || bytes >= 64 * 1024 * 1024 || files >= 1000) {
      partial = true;
      break;
    }
    nextOffset++;
    const candidate = join(root, projectDirectoryName(path));
    let folder: string;
    try {
      folder = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') partial = true;
      continue;
    }
    if (!folder.startsWith(root + sep)) {
      partial = true;
      continue;
    }
    if (visited.has(folder)) continue;
    visited.add(folder);
    const entries: { path: string; id: string; modified: number }[] = [];
    try {
      let count = 0;
      for await (const entry of await opendir(folder)) {
        if (++count > 5000 || Date.now() >= deadline || signal?.aborted) {
          partial = true;
          break;
        }
        const id = entry.name.replace(/\.jsonl$/, '');
        if (!entry.isFile() || !entry.name.endsWith('.jsonl') || !uuid.test(id)) continue;
        const file = join(folder, entry.name);
        try {
          entries.push({ path: file, id, modified: (await stat(file)).mtimeMs });
        } catch {
          partial = true;
        }
      }
      entries.sort((a, b) => b.modified - a.modified);
      for (const entry of entries) {
        if (signal?.aborted) throw new Error('Cancelled');
        if (Date.now() >= deadline || bytes >= 64 * 1024 * 1024 || files >= 1000) {
          partial = true;
          break;
        }
        files++;
        bytes += HALF * 2; // Reserve the maximum read even when a file fails midway.
        try {
          const result = await readSession(entry.path, entry.id, paths);
          partial ||= result.partial;
          if (
            result.task &&
            (!tasks.has(entry.id) || tasks.get(entry.id)!.updatedAt < result.task.updatedAt)
          )
            tasks.set(entry.id, result.task);
        } catch {
          partial = true;
        }
      }
    } catch {
      partial = true;
    }
  }
  if (signal?.aborted) throw new Error('Cancelled');
  return { tasks: [...tasks.values()], checkedAt: new Date().toISOString(), partial, nextOffset };
}

export function createClaudeHistorySource(directory = claudeDirectory()): HistorySource {
  let offset = 0;
  return {
    tool: 'claude-code',
    read: async (repositories, signal) => {
      const result = await readClaudeIndex(repositories, directory, signal, offset);
      if (!signal?.aborted) offset = result.nextOffset ?? 0;
      return result;
    },
  };
}
