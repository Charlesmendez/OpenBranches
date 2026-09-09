import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// This connection only exposes inspection. It cannot create/resume a thread,
// start a model turn, execute a command, or change Codex settings.
export type InspectionMethod =
  | 'initialize'
  | 'thread/list'
  | 'thread/loaded/list'
  | 'thread/read'
  | 'account/read'
  | 'account/rateLimits/read';
const methods = new Set<InspectionMethod>([
  'initialize',
  'thread/list',
  'thread/loaded/list',
  'thread/read',
  'account/read',
  'account/rateLimits/read',
]);
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexInspectionClient {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private closed = false;

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    // Drain, but never log stderr: it can include private paths or credentials.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.fail('The Codex connection closed. Try reconnecting.'));
    child.on('error', () => this.fail('Codex could not start. Check your installation.'));
    child.on('exit', () => this.fail('Codex stopped before inspection finished.'));
  }

  static launch(executable: string, cwd: string) {
    return new CodexInspectionClient(
      spawn(
        executable,
        [
          'app-server',
          '--listen',
          'stdio://',
          '--disable',
          'hooks',
          '--disable',
          'apps',
          '--disable',
          'plugins',
          '--disable',
          'shell_tool',
          '--disable',
          'unified_exec',
          '--disable',
          'multi_agent',
        ],
        { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      ),
    );
  }

  /** Attach to the existing daemon for live status. Ending the proxy leaves
   * the daemon and all of the user's tasks running. No daemon is started. */
  static launchLive(executable: string, cwd: string) {
    return new CodexInspectionClient(
      spawn(executable, ['app-server', 'proxy'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'openbranches', title: 'OpenBranches', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    });
    this.send({ method: 'initialized', params: {} });
  }

  request(method: InspectionMethod, params: unknown, timeout = 15_000): Promise<unknown> {
    if (!methods.has(method)) return Promise.reject(new Error('Unsupported inspection method.'));
    if (
      method === 'thread/read' &&
      (!params ||
        typeof params !== 'object' ||
        (params as { includeTurns?: unknown }).includeTurns !== false)
    )
      return Promise.reject(new Error('Task inspection requires includeTurns: false.'));
    if (this.closed) return Promise.reject(new Error('The Codex connection is closed.'));
    if (this.pending.size >= 4)
      return Promise.reject(new Error('Too many Codex inspection requests.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail('Codex inspection timed out. Try again.'), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  private send(message: unknown) {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.buffer += this.decoder.write(chunk);
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
        this.fail('Codex returned more data than inspection can safely display.');
        return;
      }
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        if ('method' in message) {
          if ('id' in message) {
            // No approval, tool, sign-in, or elicitation request is accepted.
            this.send({ id: message.id, error: { code: -32601, message: 'Inspection only.' } });
            this.fail('Codex requested an action during read-only inspection. Connection stopped.');
            return;
          }
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if ('error' in message) {
          pending.reject(
            new Error('Codex could not read its task index. Update Codex and try again.'),
          );
        } else if ('result' in message) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error('Codex returned an unsupported response.'));
        }
      } catch {
        this.fail('Codex returned an unreadable response. Update Codex and try again.');
        return;
      }
    }
    if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES)
      this.fail('Codex returned more data than inspection can safely display.');
  }

  private fail(message: string) {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
      const child = this.child;
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2000);
      force.unref();
      child.once('exit', () => clearTimeout(force));
    }
  }

  close() {
    this.fail('Codex inspection was disconnected.');
  }
}
