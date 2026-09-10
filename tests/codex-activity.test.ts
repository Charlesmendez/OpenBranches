import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexActivityLogReader, extractExecWorkdir } from '../electron/codex/activity';
import type { CodexTask } from '../electron/codex/reader';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

describe('Codex local activity', () => {
  it('extracts only a literal orchestration workdir outside commands, comments, and templates', () => {
    const source = `
      const quoted = 'workdir: "/private/quoted"';
      // workdir: "/private/comment"
      const template = \`workdir: "/private/template"\`;
      const unrelated = { workdir: "/private/unrelated" };
      await tools.exec_command({
        cmd: "printf 'workdir: \\\"/private/command\\\"'",
        workdir: "/fixture/atlas-search"
      });
    `;
    expect(extractExecWorkdir(source)).toBe('/fixture/atlas-search');
    expect(extractExecWorkdir(`tools.exec_command({ workdir: '/fixture/with space' })`)).toBe(
      '/fixture/with space',
    );
    expect(extractExecWorkdir('tools.exec_command({ workdir: dynamicPath })')).toBeUndefined();
    expect(extractExecWorkdir('const value = { workdir: "/fixture/not-a-call" }')).toBeUndefined();
  });

  it('follows the exact recent tool checkout and discards private transcript fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openbranches-codex-activity-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, '2026', '09', '10');
    await mkdir(folder, { recursive: true });
    const id = '01a083c2-0813-7143-af80-a0cebcb53145';
    const path = join(folder, `rollout-2026-09-10T12-00-00-${id}.jsonl`);
    let now = Date.now();
    const at = () => new Date(now).toISOString();
    const records = [
      record(at(), 'event_msg', { type: 'task_started', privatePrompt: 'PRIVATE_PROMPT' }),
      record(at(), 'turn_context', {
        cwd: '/fixture/original-project',
        model: 'gpt-6-astra',
        privateInstructions: 'PRIVATE_INSTRUCTIONS',
      }),
      record(at(), 'response_item', {
        type: 'custom_tool_call',
        name: 'exec',
        input: `await tools.exec_command({ cmd: "PRIVATE_COMMAND workdir: \\\"/fake\\\"", workdir: "/fixture/atlas-search" })`,
      }),
    ];
    await writeFile(path, records.join('\n') + '\n');
    const reader = new CodexActivityLogReader(root, () => now);
    cleanup.unshift(() => reader.close());
    const saved: CodexTask = {
      id,
      cwd: '/fixture/original-project',
      createdAt: Math.floor(now / 1000) - 60,
      updatedAt: Math.floor(now / 1000) - 30,
      archived: false,
      name: 'Build branch map',
      gitInfo: null,
    };

    const active = await reader.read([saved]);
    expect(active.partial).toBe(false);
    expect(active.tasks).toEqual([
      expect.objectContaining({
        id,
        name: 'Build branch map',
        cwd: '/fixture/atlas-search',
        archived: false,
        model: { id: 'gpt-6-astra', provider: 'openai' },
        runtime: expect.objectContaining({ state: 'active', source: 'codex-session-log' }),
      }),
    ]);
    expect(JSON.stringify(active)).not.toMatch(/PRIVATE|fake|command|prompt|instructions/i);

    now += 1_000;
    await appendFile(path, record(at(), 'event_msg', { type: 'task_complete' }) + '\n');
    expect((await reader.read([saved])).tasks).toEqual([]);

    now += 1_000;
    await appendFile(
      path,
      [
        record(at(), 'event_msg', { type: 'task_started' }),
        record(at(), 'turn_context', { cwd: '/fixture/new-project' }),
        record(at(), 'response_item', {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'PRIVATE_LEGACY_COMMAND',
            workdir: '/fixture/legacy-checkout',
          }),
        }),
      ].join('\n') + '\n',
    );
    expect((await reader.read([saved])).tasks[0].cwd).toBe('/fixture/legacy-checkout');

    now += 91_000;
    expect((await reader.read([saved])).tasks).toEqual([]);
  });
});

function record(timestamp: string, type: string, payload: Record<string, unknown>) {
  return JSON.stringify({ timestamp, type, payload });
}
