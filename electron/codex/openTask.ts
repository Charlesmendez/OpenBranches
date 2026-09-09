import { z } from 'zod';
import type { OpenTaskCommand, OpenTaskResult } from '../../src/domain/types';

const commandSchema = z
  .object({
    repositoryId: z.string().min(1).max(4096),
    branchId: z.string().min(1).max(4096),
    taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/),
  })
  .strict();

interface TaskDestination {
  isLinked: (command: OpenTaskCommand) => boolean;
  applicationFor: (url: string) => Promise<unknown>;
  open: (url: string) => Promise<void>;
}

// Only existing local tasks are destinations. Never accept a renderer-supplied
// URL, the reserved creation route, a prompt, or another deep-link command.
export async function openCodexTask(
  input: unknown,
  destination: TaskDestination,
): Promise<OpenTaskResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success || parsed.data.taskId.toLowerCase() === 'new') return 'invalid-link';
  const command = parsed.data;
  if (!destination.isLinked(command)) return 'not-linked';
  const url = `codex://threads/${command.taskId}`;
  try {
    await destination.applicationFor(url);
  } catch {
    return 'unavailable';
  }
  // A project can be removed, tasks refreshed, or Codex disconnected while the
  // operating system looks up the handler. Recheck before launching anything.
  if (!destination.isLinked(command)) return 'not-linked';
  try {
    await destination.open(url);
    return 'sent';
  } catch {
    return 'failed';
  }
}
