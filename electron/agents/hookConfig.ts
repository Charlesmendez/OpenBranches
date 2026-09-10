import { constants } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LiveAgentTool } from '../../src/domain/types';

const claudeEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'CwdChanged',
  'DirectoryAdded',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'Elicitation',
  'ElicitationResult',
  'SessionEnd',
] as const;
const codexEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
  'SessionEnd',
] as const;
const cursorEvents = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'preCompact',
  'stop',
  'afterAgentResponse',
  'afterAgentThought',
] as const;

type JsonObject = Record<string, unknown>;

export class AgentHookInstaller {
  constructor(private home = homedir()) {}

  async installed(tool: LiveAgentTool) {
    const location = this.location(tool);
    try {
      const value = await readJsonObject(location.config);
      if (!configured(value, tool, shellQuote(location.script))) return false;
      await assertRegularOrMissing(location.script);
      return (await readFile(location.script, 'utf8')).includes(
        '# OpenBranches live activity hook v1',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async install(tool: LiveAgentTool, endpoint: string, token: string) {
    const location = this.location(tool);
    const command = shellQuote(location.script);
    await assertRegularOrMissing(location.config);
    await assertRegularOrMissing(location.script);
    let value: JsonObject;
    try {
      value = await readJsonObject(location.config);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      value = {};
    }
    const next = addHooks(value, tool, command);
    await mkdir(dirname(location.script), { recursive: true, mode: 0o700 });
    await atomicWrite(location.script, reporterScript(tool, endpoint, token), 0o700);
    await atomicWrite(location.config, JSON.stringify(next, null, 2) + '\n', 0o600);
  }

  async uninstall(tool: LiveAgentTool) {
    const location = this.location(tool);
    await assertRegularOrMissing(location.config);
    let value: JsonObject | undefined;
    try {
      value = await readJsonObject(location.config);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') value = undefined;
      else throw error;
    }
    if (value) {
      const next = removeHooks(value, tool, shellQuote(location.script));
      await atomicWrite(location.config, JSON.stringify(next, null, 2) + '\n', 0o600);
    }
    try {
      await unlink(location.script);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private location(tool: LiveAgentTool) {
    const folder = tool === 'codex' ? '.codex' : tool === 'claude-code' ? '.claude' : '.cursor';
    return {
      config: join(this.home, folder, tool === 'claude-code' ? 'settings.json' : 'hooks.json'),
      script: join(this.home, folder, 'openbranches-live.sh'),
    };
  }
}

function addHooks(value: JsonObject, tool: LiveAgentTool, command: string): JsonObject {
  const next = structuredClone(value);
  if (tool === 'cursor' && next.version !== undefined && next.version !== 1)
    throw new Error('Cursor uses an unsupported hooks file version.');
  if (tool === 'cursor' && next.version === undefined) next.version = 1;
  const hooks = objectAt(next, 'hooks');
  for (const event of eventsFor(tool)) {
    const entries = arrayAt(hooks, event);
    if (configuredEvent(entries, tool, command)) continue;
    entries.push(
      tool !== 'cursor'
        ? { hooks: [{ type: 'command', command, timeout: 2, async: true }] }
        : { command },
    );
  }
  return next;
}

function removeHooks(value: JsonObject, tool: LiveAgentTool, command: string): JsonObject {
  const next = structuredClone(value);
  if (!isObject(next.hooks)) return next;
  for (const [event, raw] of Object.entries(next.hooks)) {
    if (!Array.isArray(raw)) continue;
    const entries = raw.flatMap((entry) => {
      if (!isObject(entry)) return [entry];
      if (tool === 'cursor') return entry.command === command ? [] : [entry];
      if (!Array.isArray(entry.hooks)) return [entry];
      const handlers = entry.hooks.filter(
        (handler) => !isObject(handler) || handler.command !== command,
      );
      return handlers.length ? [{ ...entry, hooks: handlers }] : [];
    });
    if (entries.length) next.hooks[event] = entries;
    else delete next.hooks[event];
  }
  return next;
}

function configured(value: JsonObject, tool: LiveAgentTool, command: string) {
  const hooks = value.hooks;
  if (!isObject(hooks)) return false;
  return eventsFor(tool).every((event) => {
    const entries = hooks[event];
    return Array.isArray(entries) && configuredEvent(entries, tool, command);
  });
}

function configuredEvent(entries: unknown[], tool: LiveAgentTool, command: string) {
  return entries.some((entry) => {
    if (!isObject(entry)) return false;
    if (tool === 'cursor') return entry.command === command;
    return (
      Array.isArray(entry.hooks) &&
      entry.hooks.some((handler) => isObject(handler) && handler.command === command)
    );
  });
}

function objectAt(value: JsonObject, key: string): JsonObject {
  if (value[key] === undefined) value[key] = {};
  if (!isObject(value[key])) throw new Error(`Expected ${key} to be a JSON object.`);
  return value[key];
}

function arrayAt(value: JsonObject, key: string): unknown[] {
  if (value[key] === undefined) value[key] = [];
  if (!Array.isArray(value[key])) throw new Error(`Expected hooks.${key} to be an array.`);
  return value[key];
}

async function readJsonObject(path: string): Promise<JsonObject> {
  const text = await readFile(path, 'utf8');
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error('The hooks settings file must contain a JSON object.');
  return value;
}

async function assertRegularOrMissing(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('Refusing to modify a non-regular hooks file.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function atomicWrite(path: string, body: string, mode: number) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.openbranches.tmp`);
  try {
    await writeFile(temporary, body, {
      encoding: 'utf8',
      mode,
      flag: constants.O_EXCL | constants.O_CREAT | constants.O_WRONLY,
    });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      /* Best-effort cleanup of an owned temporary file. */
    }
    throw error;
  }
}

function reporterScript(tool: LiveAgentTool, endpoint: string, token: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1\/events\/(?:codex|claude-code|cursor)$/.test(endpoint))
    throw new Error('Invalid local hook endpoint.');
  if (!/^[a-f\d]{64}$/.test(token)) throw new Error('Invalid local hook token.');
  return `#!/bin/sh\n# OpenBranches live activity hook v1\n/usr/bin/curl --silent --max-time 1 --request POST --header 'Content-Type: application/json' --header 'Authorization: Bearer ${token}' --data-binary @- '${endpoint}' >/dev/null 2>&1 || true\n${tool === 'codex' ? "printf '{}\\n'" : ''}\nexit 0\n`;
}

function eventsFor(tool: LiveAgentTool): readonly string[] {
  return tool === 'codex' ? codexEvents : tool === 'claude-code' ? claudeEvents : cursorEvents;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
