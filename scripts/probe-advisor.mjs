// Developer-only negative/positive capability check. All generated model traffic
// goes to a loopback stub with a dummy token. No real model is called.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const directory = await mkdtemp(join(tmpdir(), 'openbranches-probe-'));
const base = 'You are a read-only branch advisor. Analyze supplied JSON only.';
const developer = 'Do not call tools. Return only JSON.';
const input = '{"repositories":[],"fixture":"public fictional metadata"}';
const name = `openbranches_probe_${randomUUID().replaceAll('-', '')}`;
const instructions = join(directory, 'instructions.md');
await writeFile(instructions, base);
const disabled = [
  'hooks',
  'apps',
  'plugins',
  'remote_plugin',
  'shell_tool',
  'unified_exec',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'code_mode',
  'code_mode_host',
  'code_mode_only',
  'image_generation',
  'memories',
  'workspace_dependencies',
  'shell_snapshot',
  'goals',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'request_permissions_tool',
];
let active;
let settle;
const observed = new Promise((resolve) => {
  settle = resolve;
});
const server = createServer((request, response) => {
  if (
    request.method === 'GET' &&
    request.headers.authorization === 'Bearer openbranches-fixture-token'
  ) {
    // A custom provider may probe its model catalog before the first response.
    // Return no catalog; never proxy a metadata request to another destination.
    response.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
    return;
  }
  if (
    request.method !== 'POST' ||
    request.url !== `/${name}/responses` ||
    request.headers.authorization !== 'Bearer openbranches-fixture-token'
  ) {
    response.writeHead(403).end();
    settle({
      readyForModelExecution: false,
      reason: 'Unexpected stub request.',
      method: request.method,
      expectedPath: request.url === `/${name}/responses`,
      dummyAuthentication: request.headers.authorization === 'Bearer openbranches-fixture-token',
    });
    return;
  }
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) {
      request.destroy();
      settle({ readyForModelExecution: false, reason: 'Model context exceeded the probe bound.' });
    }
  });
  request.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const items = Array.isArray(payload.input) ? payload.input : [];
      const ordinaryTools = Array.isArray(payload.tools) ? payload.tools.length : 0;
      const injectedTools = items
        .filter((item) => item.type === 'additional_tools')
        .reduce((sum, item) => sum + (Array.isArray(item.tools) ? item.tools.length : 0), 0);
      const itemText = (item) =>
        typeof item.content === 'string'
          ? item.content
          : Array.isArray(item.content)
            ? item.content.map((part) => part.text ?? '').join('')
            : '';
      const allowed = new Set([base, developer, input]);
      const extraContext =
        items.some((item) => item.type !== 'message' || !allowed.has(itemText(item))) ||
        (!!payload.instructions && !allowed.has(payload.instructions));
      const hasInput = items.some((item) => item.role === 'user' && itemText(item) === input);
      settle({
        modelCalls: 'local stub only',
        ordinaryTools,
        injectedTools,
        extraContext,
        readyForModelExecution: hasInput && !ordinaryTools && !injectedTools && !extraContext,
      });
    } catch {
      settle({ readyForModelExecution: false, reason: 'Unrecognized model request.' });
    }
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { message: 'Local probe complete; no model called.', type: 'invalid_request_error' },
      }),
    );
  });
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const port = server.address().port;
function toml(value) {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}=${toml(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function launch(mcpNames) {
  const overrides = {
    web_search: 'disabled',
    'tools.view_image': false,
    project_doc_max_bytes: 0,
    model_instructions_file: instructions,
    developer_instructions: developer,
    include_environment_context: false,
    include_permissions_instructions: false,
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    notify: [],
    model_provider: name,
    default_permissions: name,
    approval_policy: 'never',
    [`permissions.${name}`]: {
      filesystem: { ':minimal': 'read', [directory]: 'read' },
      network: { enabled: false },
    },
    [`model_providers.${name}`]: {
      name: 'OpenBranches local probe',
      base_url: `http://127.0.0.1:${port}/${name}`,
      env_key: 'OPENBRANCHES_PROBE_TOKEN',
      wire_api: 'responses',
      requires_openai_auth: false,
      request_max_retries: 0,
      stream_max_retries: 0,
    },
    ...(mcpNames.length
      ? { mcp_servers: Object.fromEntries(mcpNames.map((key) => [key, { enabled: false }])) }
      : {}),
  };
  const args = [
    'app-server',
    '--listen',
    'stdio://',
    ...disabled.flatMap((feature) => ['--disable', feature]),
    ...Object.entries(overrides).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`]),
  ];
  const env = { ...process.env, OPENBRANCHES_PROBE_TOKEN: 'openbranches-fixture-token' };
  // Do not attach this child to the development task's UI/tool bridge.
  for (const key of Object.keys(env))
    if (
      key.startsWith('CODEX_') &&
      !['CODEX_HOME', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'].includes(key)
    )
      delete env[key];
  const child = spawn('codex', args, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const decoder = new StringDecoder('utf8');
  let nextId = 0,
    buffer = '',
    closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('Probe connection stopped.'));
    }
    pending.clear();
    child.stdin.end();
    child.kill();
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000);
    force.unref();
    child.once('exit', () => clearTimeout(force));
  };
  child.on('error', stop);
  child.on('exit', stop);
  child.stdin.on('error', stop);
  child.stderr.on('data', () => {}); // Never print private config errors or paths.
  child.stdout.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      stop();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.method && 'id' in message) {
          child.stdin.write(
            JSON.stringify({
              id: message.id,
              error: { code: -32601, message: 'Probe does not execute actions.' },
            }) + '\n',
          );
          stop();
          return;
        }
        const call = pending.get(message.id);
        if (call) {
          clearTimeout(call.timer);
          pending.delete(message.id);
          message.error
            ? call.reject(new Error('Installed Codex rejected the probe configuration.'))
            : call.resolve(message.result);
        }
      } catch {
        stop();
        return;
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('Probe connection is closed.'));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        stop();
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  return {
    request,
    stop,
    initialize: async () => {
      await request('initialize', {
        clientInfo: { name: 'openbranches_probe', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    },
  };
}
const timeout = setTimeout(() => {
  settle({ readyForModelExecution: false, reason: 'Probe deadline reached.' });
  active?.stop();
}, 40000);
try {
  active = launch([]);
  await active.initialize();
  let { config } = await active.request('config/read', { includeLayers: false });
  const names = Object.keys(config.mcp_servers ?? {});
  active.stop();
  active = launch(names);
  await active.initialize();
  ({ config } = await active.request('config/read', { includeLayers: false }));
  if (
    !disabled.every((key) => config.features?.[key] === false) ||
    Object.values(config.mcp_servers ?? {}).some((value) => value.enabled !== false)
  )
    throw new Error('Inherited capabilities were not disabled.');
  const thread = await active.request('thread/start', {
    model: 'gpt-5.6-terra',
    modelProvider: name,
    cwd: directory,
    ephemeral: true,
    baseInstructions: base,
    developerInstructions: developer,
    permissions: name,
    approvalPolicy: 'never',
    selectedCapabilityRoots: [],
    runtimeWorkspaceRoots: [],
  });
  if (
    thread.thread?.ephemeral !== true ||
    thread.sandbox?.type !== 'readOnly' ||
    thread.sandbox.networkAccess !== false
  )
    throw new Error('Codex did not confirm the requested ephemeral read-only thread.');
  await active.request('turn/start', {
    threadId: thread.thread.id,
    input: [{ type: 'text', text: input }],
    permissions: name,
    approvalPolicy: 'never',
    outputSchema: {
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'string' } } },
      required: ['findings'],
      additionalProperties: false,
    },
  });
  const result = await observed;
  console.log(JSON.stringify(result));
  process.exitCode = result.readyForModelExecution ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ readyForModelExecution: false, reason: error.message }));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  active?.stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
