import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { HandoffProvider, HandoffProviderStatus } from '../../src/domain/types';
import { findCodex } from '../codex/executable';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 40_000;
const RUN_TIMEOUT_MS = 30 * 60_000;

export interface AgentTools {
  statuses: HandoffProviderStatus[];
  paths: Partial<Record<HandoffProvider, string>>;
}
export interface AgentRun {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<{ externalTaskId?: string; result?: string }>;
}

const candidates = (name: string) =>
  new Set([
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    join(homedir(), '.local/bin', name),
    ...(process.env.PATH ?? '')
      .split(':')
      .filter(isAbsolute)
      .map((directory) => join(directory, name)),
  ]);

async function findExecutable(name: string): Promise<string | undefined> {
  for (const path of candidates(name)) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Optional provider; keep looking in standard executable locations.
    }
  }
}

export async function detectAgentTools(): Promise<AgentTools> {
  const [codex, claude, cursor] = await Promise.all([
    findCodex(),
    findExecutable('claude'),
    findExecutable('cursor-agent'),
  ]);
  const paths: AgentTools['paths'] = {
    ...(codex?.supported ? { codex: codex.path } : {}),
    ...(claude ? { 'claude-code': claude } : {}),
    ...(cursor ? { cursor } : {}),
  };
  return {
    paths,
    statuses: [
      { provider: 'codex', label: 'Codex', installed: !!paths.codex },
      { provider: 'claude-code', label: 'Claude', installed: !!paths['claude-code'] },
      { provider: 'cursor', label: 'Cursor', installed: !!paths.cursor },
    ],
  };
}

export const agentCommand = (provider: HandoffProvider, path: string, cwd: string) => {
  switch (provider) {
    case 'codex':
      return {
        path,
        args: [
          '-a',
          'never',
          'exec',
          '--json',
          '--sandbox',
          'read-only',
          '--color',
          'never',
          '-C',
          cwd,
          '-',
        ],
      };
    case 'claude-code':
      return {
        path,
        args: [
          '-p',
          '--permission-mode',
          'plan',
          '--output-format',
          'json',
          '--name',
          'OpenBranches review',
        ],
      };
    case 'cursor':
      return { path, args: ['-p', '--mode=ask', '--output-format', 'json'] };
  }
};

function stringsIn(value: unknown, keys: string[]): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct = keys.flatMap((key) =>
    typeof record[key] === 'string' ? [record[key] as string] : [],
  );
  return direct.concat(
    Object.values(record).flatMap((item) =>
      Array.isArray(item) ? item.flatMap((entry) => stringsIn(entry, keys)) : stringsIn(item, keys),
    ),
  );
}

function parseOutput(provider: HandoffProvider, output: string) {
  const documents = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  const externalTaskId = documents
    .flatMap((value) =>
      stringsIn(value, ['thread_id', 'threadId', 'session_id', 'sessionId', 'chat_id', 'chatId']),
    )
    .find((value) => /^[A-Za-z0-9][A-Za-z0-9_-]{5,199}$/.test(value));
  const resultKeys = provider === 'codex' ? ['text'] : ['result', 'text', 'message'];
  const result = documents
    .flatMap((value) => stringsIn(value, resultKeys))
    .filter((value) => value.trim().length > 20)
    .at(-1);
  return {
    ...(externalTaskId ? { externalTaskId } : {}),
    ...(result ? { result: result.slice(0, MAX_RESULT_CHARS) } : {}),
  };
}

export function runAgent(
  provider: HandoffProvider,
  executable: string,
  cwd: string,
  prompt: string,
): AgentRun {
  const command = agentCommand(provider, executable, cwd);
  const child = spawn(command.path, command.args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const completion = new Promise<{ externalTaskId?: string; result?: string }>(
    (resolve, reject) => {
      let output = '';
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(parseOutput(provider, output));
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new Error('The agent did not finish within 30 minutes.'));
      }, RUN_TIMEOUT_MS);
      timer.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill('SIGTERM');
          finish(new Error('The agent returned more output than OpenBranches can safely keep.'));
          return;
        }
        output += chunk.toString('utf8');
      });
      // Drain stderr without retaining it; provider errors can contain private paths.
      child.stderr.on('data', () => {});
      child.on('error', () => finish(new Error('The agent could not be started.')));
      child.on('exit', (code) =>
        finish(
          code === 0 ? undefined : new Error('The agent stopped before returning a proposal.'),
        ),
      );
    },
  );
  child.stdin.end(prompt);
  return { child, completion };
}
