import { constants, watch, type FSWatcher } from 'node:fs';
import { open, opendir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import type { CodexIndex, CodexTask } from './reader';

const UUID = /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi;
const SESSION_FILE = /^rollout-.+\.jsonl$/;
const MAX_ENTRIES = 20_000;
const MAX_RECENT_FILES = 200;
const MAX_TAIL_BYTES = 512 * 1024;
const RETENTION = 5 * 60_000;
const LIVE_TTL = 90_000;
const FUTURE_TOLERANCE = 60_000;
const RECONCILE_INTERVAL = 60_000;

interface ActivityState {
  id: string;
  path: string;
  offset: number;
  remainder: string;
  active: boolean;
  cwd?: string;
  model?: string;
  updatedAt?: number;
}

export interface CodexActivitySource {
  read(savedTasks: CodexTask[]): Promise<CodexIndex>;
  close(): void;
}

/** Reads only recent structural events from local Codex rollout logs. Prompts,
 * commands, responses, tool input/output, and file names never leave this module. */
export class CodexActivityLogReader implements CodexActivitySource {
  private watcher?: FSWatcher;
  private states = new Map<string, ActivityState>();
  private dirty = new Set<string>();
  private nextReconcile = 0;
  private partial = false;
  private closed = false;

  constructor(
    private root = join(homedir(), '.codex', 'sessions'),
    private clock = () => Date.now(),
  ) {}

  async read(savedTasks: CodexTask[]): Promise<CodexIndex> {
    const now = this.clock();
    if (this.closed) return { tasks: [], checkedAt: new Date(now).toISOString(), partial: true };
    if (now >= this.nextReconcile) await this.reconcile(now);
    await this.pollTracked();
    await this.readDirty(now);
    const saved = new Map(savedTasks.map((task) => [task.id, task]));
    const tasks = new Map<string, CodexTask>();
    for (const state of this.states.values()) {
      if (
        !state.active ||
        !state.cwd ||
        state.updatedAt === undefined ||
        !fresh(state.updatedAt, now)
      )
        continue;
      const prior = saved.get(state.id);
      const task: CodexTask = {
        ...(prior ?? {
          id: state.id,
          cwd: state.cwd,
          createdAt: Math.floor(state.updatedAt / 1000),
          updatedAt: Math.floor(state.updatedAt / 1000),
          archived: false,
        }),
        cwd: state.cwd,
        updatedAt: Math.floor(state.updatedAt / 1000),
        archived: false,
        ...(state.model ? { model: { id: state.model, provider: 'openai' as const } } : {}),
        runtime: {
          state: 'active',
          checkedAt: new Date(state.updatedAt).toISOString(),
          source: 'codex-session-log',
        },
      };
      const existing = tasks.get(state.id);
      if (!existing || existing.updatedAt < task.updatedAt) tasks.set(state.id, task);
    }
    return {
      tasks: [...tasks.values()],
      checkedAt: new Date(now).toISOString(),
      partial: this.partial,
    };
  }

  close() {
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
    this.dirty.clear();
    this.states.clear();
  }

  private async reconcile(now: number) {
    this.partial = false;
    const recent: { path: string; modified: number }[] = [];
    const pending = [{ path: this.root, depth: 0 }];
    let entries = 0;
    while (pending.length && entries < MAX_ENTRIES) {
      const folder = pending.pop()!;
      try {
        for await (const entry of await opendir(folder.path)) {
          if (++entries > MAX_ENTRIES) {
            this.partial = true;
            break;
          }
          const path = join(folder.path, entry.name);
          if (entry.isDirectory() && folder.depth < 5) {
            pending.push({ path, depth: folder.depth + 1 });
            continue;
          }
          if (!entry.isFile() || !SESSION_FILE.test(entry.name)) continue;
          try {
            const modified = (await stat(path)).mtimeMs;
            if (modified >= now - RETENTION && modified <= now + FUTURE_TOLERANCE)
              recent.push({ path, modified });
          } catch {
            this.partial = true;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.partial = true;
      }
    }
    if (pending.length) this.partial = true;
    recent.sort((a, b) => b.modified - a.modified);
    if (recent.length > MAX_RECENT_FILES) this.partial = true;
    for (const item of recent.slice(0, MAX_RECENT_FILES)) this.dirty.add(item.path);
    this.startWatcher();
    this.nextReconcile = now + (this.watcher ? RECONCILE_INTERVAL : 5_000);
  }

  private startWatcher() {
    if (this.watcher || this.closed) return;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const path = resolve(this.root, filename.toString());
        if (!path.startsWith(resolve(this.root) + sep) || !SESSION_FILE.test(basename(path)))
          return;
        this.dirty.add(path);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.nextReconcile = 0;
      });
    } catch {
      this.watcher = undefined;
    }
  }

  private async pollTracked() {
    for (const state of this.states.values()) {
      try {
        const info = await stat(state.path);
        if (info.size !== state.offset) this.dirty.add(state.path);
      } catch {
        this.states.delete(state.path);
      }
    }
  }

  private async readDirty(now: number) {
    const paths = [...this.dirty].slice(0, MAX_RECENT_FILES);
    if (this.dirty.size > paths.length) this.partial = true;
    for (const path of paths) this.dirty.delete(path);
    for (const path of paths) {
      try {
        const state = await readActivityFile(path, this.states.get(path));
        if (
          state.updatedAt !== undefined &&
          state.updatedAt >= now - RETENTION &&
          state.updatedAt <= now + FUTURE_TOLERANCE
        )
          this.states.set(path, state);
        else this.states.delete(path);
      } catch {
        this.states.delete(path);
        this.partial = true;
      }
    }
    for (const [path, state] of this.states)
      if (
        state.updatedAt === undefined ||
        state.updatedAt < now - RETENTION ||
        state.updatedAt > now + FUTURE_TOLERANCE
      )
        this.states.delete(path);
  }
}

async function readActivityFile(path: string, previous?: ActivityState): Promise<ActivityState> {
  const id = sessionId(path);
  if (!id) throw new Error('Unsupported Codex session file');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Unsupported Codex session file');
    let state = previous?.id === id ? { ...previous } : emptyState(id, path);
    let position = state.offset;
    let length = info.size - position;
    if (length < 0 || length > MAX_TAIL_BYTES) {
      position = Math.max(0, info.size - MAX_TAIL_BYTES);
      length = info.size - position;
      state = emptyState(id, path);
    }
    if (!length) return { ...state, offset: info.size };
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await file.read(buffer, read, length - read, position + read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    let text = state.remainder + buffer.subarray(0, read).toString('utf8');
    if (position > 0 && state.offset === 0) text = text.slice(text.indexOf('\n') + 1);
    const newline = text.lastIndexOf('\n');
    state.remainder = newline === -1 ? text : text.slice(newline + 1);
    if (newline !== -1) parseActivityLines(text.slice(0, newline), state);
    state.offset = info.size;
    return state;
  } finally {
    await file.close();
  }
}

function emptyState(id: string, path: string): ActivityState {
  return { id, path, offset: 0, remainder: '', active: false };
}

function parseActivityLines(text: string, state: ActivityState) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!object(record) || !object(record.payload)) continue;
    const at = Date.parse(typeof record.timestamp === 'string' ? record.timestamp : '');
    if (!Number.isFinite(at) || at < 0 || at > 253402300799000) continue;
    const payload = record.payload;
    if (record.type === 'event_msg') {
      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
        state.active = false;
        state.cwd = undefined;
      } else if (payload.type === 'task_started' || payload.type === 'user_message') {
        state.active = true;
        if (payload.type === 'task_started') state.cwd = undefined;
      }
      state.updatedAt = at;
      continue;
    }
    if (record.type === 'turn_context') {
      state.active = true;
      state.updatedAt = at;
      if (validPath(payload.cwd)) state.cwd = resolve(payload.cwd);
      if (validModel(payload.model)) state.model = payload.model;
      continue;
    }
    if (record.type !== 'response_item') continue;
    state.active = true;
    state.updatedAt = at;
    if (
      payload.type === 'custom_tool_call' &&
      payload.name === 'exec' &&
      typeof payload.input === 'string' &&
      payload.input.length <= MAX_TAIL_BYTES
    ) {
      const workdir = extractExecWorkdir(payload.input);
      if (workdir) state.cwd = workdir;
    } else if (
      payload.type === 'function_call' &&
      payload.name === 'exec_command' &&
      typeof payload.arguments === 'string' &&
      payload.arguments.length <= MAX_TAIL_BYTES
    ) {
      try {
        const input: unknown = JSON.parse(payload.arguments);
        if (object(input) && validPath(input.workdir)) state.cwd = resolve(input.workdir);
      } catch {
        /* Unsupported call arguments do not supply path evidence. */
      }
    }
  }
}

/** Finds a literal workdir property in the orchestration source while skipping
 * quoted command bodies, comments, and templates that may contain lookalikes. */
export function extractExecWorkdir(source: string): string | undefined {
  const found: string[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index, char);
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }
    if (source.startsWith('tools.exec_command', index) && wordBoundary(source, index, 18)) {
      let cursor = skipWhitespace(source, index + 18);
      if (source[cursor++] !== '(') {
        index += 18;
        continue;
      }
      cursor = skipWhitespace(source, cursor);
      if (source[cursor] !== '{') {
        index += 18;
        continue;
      }
      const result = workdirInObject(source, cursor);
      if (result.workdir) found.push(result.workdir);
      index = result.end;
      continue;
    }
    index++;
  }
  return found.at(-1);
}

function workdirInObject(source: string, start: number) {
  let depth = 1;
  for (let index = start + 1; index < source.length;) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index, char);
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index + 2);
      if (end === -1) return { end: source.length };
      index = end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) return { end: source.length };
      index = end + 2;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return { end: index + 1 };
    else if (
      depth === 1 &&
      source.startsWith('workdir', index) &&
      wordBoundary(source, index, 7) &&
      propertyBoundary(source, index, start)
    ) {
      let cursor = skipWhitespace(source, index + 7);
      if (source[cursor++] !== ':') {
        index += 7;
        continue;
      }
      cursor = skipWhitespace(source, cursor);
      const quote = source[cursor];
      if (quote !== '"' && quote !== "'") {
        index += 7;
        continue;
      }
      const end = skipQuoted(source, cursor, quote);
      const literal = decodeLiteral(source.slice(cursor, end), quote);
      return {
        end,
        ...(literal && validPath(literal) ? { workdir: resolve(literal) } : {}),
      };
    }
    index++;
  }
  return { end: source.length };
}

function skipQuoted(source: string, start: number, quote: string) {
  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === quote) return index + 1;
  }
  return source.length;
}

function decodeLiteral(literal: string, quote: string) {
  try {
    if (quote === '"') return JSON.parse(literal) as unknown;
    const body = literal.slice(1, -1);
    if (/\\(?![\\'])/.test(body)) return;
    return body.replaceAll("\\'", "'").replaceAll('\\\\', '\\');
  } catch {
    return;
  }
}

function wordBoundary(source: string, start: number, length: number) {
  return !/[\w$]/.test(source[start - 1] ?? '') && !/[\w$]/.test(source[start + length] ?? '');
}

function propertyBoundary(source: string, start: number, objectStart: number) {
  let index = start - 1;
  while (index > objectStart && /\s/.test(source[index])) index--;
  return source[index] === '{' || source[index] === ',';
}

function skipWhitespace(source: string, start: number) {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index++;
  return index;
}

function sessionId(path: string) {
  const matches = basename(path).match(UUID);
  return matches?.at(-1)?.toLowerCase();
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 16_384 &&
    !value.includes('\0') &&
    isAbsolute(value)
  );
}

function validModel(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fresh(value: number, now: number) {
  return value <= now + FUTURE_TOLERANCE && now - value <= LIVE_TTL;
}

export function createCodexActivitySource() {
  return new CodexActivityLogReader();
}
