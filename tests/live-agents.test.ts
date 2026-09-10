import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentHookInstaller } from '../electron/agents/hookConfig';
import { parseLiveHookEvent } from '../electron/agents/liveEvents';
import { LiveAgentService } from '../electron/agents/liveService';
import { AppStore } from '../electron/services/store';
import type { Repository, Snapshot } from '../src/domain/types';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'openbranches-live-agent-test-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

describe('live hook payloads', () => {
  it('retains only structural Codex fields and maps lifecycle events to presence', () => {
    const base = {
      session_id: 'codex-session',
      cwd: '/fixture/atlas',
      hook_event_name: 'PreToolUse',
      model: 'gpt-6-astra',
      prompt: 'PRIVATE_PROMPT',
      tool_input: { command: 'PRIVATE_COMMAND' },
      transcript_path: '/private/transcript',
    };
    const active = parseLiveHookEvent('codex', base);
    expect(active).toEqual({
      id: base.session_id,
      tool: 'codex',
      cwd: base.cwd,
      state: 'active',
      model: { id: 'gpt-6-astra', provider: 'openai' },
    });
    expect(JSON.stringify(active)).not.toMatch(/PRIVATE|prompt|command|transcript/);
    expect(
      parseLiveHookEvent('codex', { ...base, hook_event_name: 'PermissionRequest' }).state,
    ).toBe('waiting');
    expect(parseLiveHookEvent('codex', { ...base, hook_event_name: 'Stop' }).state).toBe('idle');
  });

  it('retains only structural Claude fields and uses explicit waiting and idle events', () => {
    const base = {
      session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cwd: '/fixture/atlas',
      hook_event_name: 'PreToolUse',
      prompt: 'PRIVATE_PROMPT',
      tool_input: { command: 'PRIVATE_COMMAND' },
      transcript_path: '/private/transcript',
    };
    const active = parseLiveHookEvent('claude-code', base);
    expect(active).toEqual({
      id: base.session_id,
      tool: 'claude-code',
      cwd: base.cwd,
      state: 'active',
    });
    expect(JSON.stringify(active)).not.toMatch(/PRIVATE|prompt|command|transcript/);
    expect(
      parseLiveHookEvent('claude-code', {
        ...base,
        hook_event_name: 'PermissionRequest',
      }).state,
    ).toBe('waiting');
    expect(parseLiveHookEvent('claude-code', { ...base, hook_event_name: 'Stop' }).state).toBe(
      'idle',
    );
    expect(
      parseLiveHookEvent('claude-code', {
        ...base,
        hook_event_name: 'Notification',
        notification_type: 'auth_success',
      }).state,
    ).toBe('idle');
  });

  it('uses one exact Cursor workspace and keeps a reported Grok model separate from Cursor', () => {
    const event = parseLiveHookEvent('cursor', {
      conversation_id: 'cursor-session',
      hook_event_name: 'beforeSubmitPrompt',
      workspace_roots: ['/fixture/atlas'],
      model: 'legacy-model',
      model_id: 'grok-code-fast-1',
      prompt: 'PRIVATE_PROMPT',
    });
    expect(event).toEqual({
      id: 'cursor-session',
      tool: 'cursor',
      cwd: '/fixture/atlas',
      state: 'active',
      model: { id: 'grok-code-fast-1', provider: 'xai' },
    });
    expect(JSON.stringify(event)).not.toContain('PRIVATE');
    expect(() =>
      parseLiveHookEvent('cursor', {
        conversation_id: 'cursor-session',
        hook_event_name: 'preToolUse',
        workspace_roots: ['/fixture/atlas', '/fixture/relay'],
      }),
    ).toThrow(/multi-root/);
  });
});

describe('coding tool hook installation', () => {
  it('merges and removes only the OpenBranches Codex hooks', async () => {
    const home = await directory();
    const folder = join(home, '.codex');
    const config = join(folder, 'hooks.json');
    await mkdir(folder);
    await writeFile(
      config,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './foreign.sh' }] }],
        },
      }),
    );
    const installer = new AgentHookInstaller(home);
    const endpoint = 'http://127.0.0.1:47836/v1/events/codex';
    const token = 'c'.repeat(64);
    await installer.install('codex', endpoint, token);
    await installer.install('codex', endpoint, token);
    expect(await installer.installed('codex')).toBe(true);
    const installed = JSON.parse(await readFile(config, 'utf8'));
    expect(installed.hooks.PreToolUse).toHaveLength(2);
    expect(installed.hooks.PreToolUse[0].hooks[0].command).toBe('./foreign.sh');
    expect(installed.hooks.SessionStart).toHaveLength(1);
    const script = await readFile(join(folder, 'openbranches-live.sh'), 'utf8');
    expect(script).toContain('/v1/events/codex');
    expect(script).toContain("printf '{}\\n'");
    await installer.uninstall('codex');
    const removed = JSON.parse(await readFile(config, 'utf8'));
    expect(removed.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: './foreign.sh' }] },
    ]);
    expect(removed.hooks.SessionStart).toBeUndefined();
    expect(await installer.installed('codex')).toBe(false);
  });

  it('merges, installs idempotently, and removes only OpenBranches Claude hooks', async () => {
    const home = await directory();
    const folder = join(home, '.claude');
    const config = join(folder, 'settings.json');
    await mkdir(folder);
    await writeFile(
      config,
      JSON.stringify({
        theme: 'dark',
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './foreign.sh' }] }],
        },
      }),
    );
    const installer = new AgentHookInstaller(home);
    const endpoint = 'http://127.0.0.1:47836/v1/events/claude-code';
    const token = 'a'.repeat(64);
    await installer.install('claude-code', endpoint, token);
    await installer.install('claude-code', endpoint, token);
    expect(await installer.installed('claude-code')).toBe(true);
    const installed = JSON.parse(await readFile(config, 'utf8'));
    expect(installed.theme).toBe('dark');
    expect(installed.hooks.PreToolUse).toHaveLength(2);
    expect(installed.hooks.PreToolUse[0].hooks[0].command).toBe('./foreign.sh');
    expect((await stat(join(folder, 'openbranches-live.sh'))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(folder, 'openbranches-live.sh'), 'utf8')).not.toContain('PRIVATE');
    await installer.uninstall('claude-code');
    const removed = JSON.parse(await readFile(config, 'utf8'));
    expect(removed.theme).toBe('dark');
    expect(removed.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: './foreign.sh' }] },
    ]);
    expect(await installer.installed('claude-code')).toBe(false);
    await installer.install('claude-code', endpoint, token);
    await rm(join(folder, 'openbranches-live.sh'));
    expect(await installer.installed('claude-code')).toBe(false);
  });

  it('preserves Cursor hooks and refuses unknown versions, malformed JSON, and symlink targets', async () => {
    const home = await directory();
    const folder = join(home, '.cursor');
    const config = join(folder, 'hooks.json');
    await mkdir(folder);
    const installer = new AgentHookInstaller(home);
    const endpoint = 'http://127.0.0.1:47836/v1/events/cursor';
    const token = 'b'.repeat(64);
    await writeFile(
      config,
      JSON.stringify({ version: 1, hooks: { stop: [{ command: './keep.sh' }] } }),
    );
    await installer.install('cursor', endpoint, token);
    await installer.install('cursor', endpoint, token);
    let value = JSON.parse(await readFile(config, 'utf8'));
    expect(value.hooks.stop).toHaveLength(2);
    await installer.uninstall('cursor');
    value = JSON.parse(await readFile(config, 'utf8'));
    expect(value.hooks.stop).toEqual([{ command: './keep.sh' }]);
    await writeFile(config, JSON.stringify({ version: 2, hooks: {} }));
    await expect(installer.install('cursor', endpoint, token)).rejects.toThrow(/version/);
    await writeFile(config, '{broken');
    await expect(installer.install('cursor', endpoint, token)).rejects.toThrow();
    const target = join(home, 'target.json');
    await writeFile(target, '{"untouched":true}');
    await rm(config);
    await symlink(target, config);
    await expect(installer.install('cursor', endpoint, token)).rejects.toThrow(/non-regular/);
    expect(await readFile(target, 'utf8')).toBe('{"untouched":true}');
  });
});

describe('private live activity listener', () => {
  it('repairs an opted-in hook on startup without requiring another setup step', async () => {
    const home = await directory();
    const store = new AppStore(join(home, 'store'));
    store.write('agents.live.claude-code.enabled', true);
    const service = new LiveAgentService(store, vi.fn(), new AgentHookInstaller(home), 0);
    cleanup.push(async () => {
      await service.close();
      store.close();
    });
    await service.start();
    expect(service.statuses().find((status) => status.tool === 'claude-code')).toMatchObject({
      enabled: true,
      installed: true,
      state: 'listening',
    });
    expect(await readFile(join(home, '.claude', 'openbranches-live.sh'), 'utf8')).toContain(
      '/v1/events/claude-code',
    );
  });

  it('rolls hook configuration back when the enabled preference cannot be saved', async () => {
    const home = await directory();
    const store = new AppStore(join(home, 'store'));
    const service = new LiveAgentService(store, vi.fn(), new AgentHookInstaller(home), 0);
    cleanup.push(async () => {
      await service.close();
      store.close();
    });
    await service.start();
    const original = store.write.bind(store);
    const write = vi.spyOn(store, 'write').mockImplementation((key, value) => {
      if (key === 'agents.live.cursor.enabled') throw new Error('Fixture write failed');
      original(key, value);
    });
    await expect(service.setEnabled('cursor', true)).rejects.toThrow(/Could not finish/);
    expect(service.statuses().find((status) => status.tool === 'cursor')).toMatchObject({
      enabled: false,
      installed: false,
      state: 'error',
    });
    expect(await new AgentHookInstaller(home).installed('cursor')).toBe(false);
    write.mockRestore();
  });

  it('authenticates, bounds, expires, and links only the exact fresh Cursor checkout', async () => {
    const home = await directory();
    const store = new AppStore(join(home, 'store'));
    const publish = vi.fn();
    const service = new LiveAgentService(store, publish, new AgentHookInstaller(home), 0);
    cleanup.push(async () => {
      await service.close();
      store.close();
    });
    await service.setEnabled('cursor', true);
    const script = await readFile(join(home, '.cursor', 'openbranches-live.sh'), 'utf8');
    const endpoint = script.match(/'(http:\/\/127\.0\.0\.1:\d+\/v1\/events\/cursor)'/)?.[1];
    const token = script.match(/Authorization: Bearer ([a-f\d]{64})/)?.[1];
    expect(endpoint).toBeTruthy();
    expect(token).toBeTruthy();
    const payload = {
      conversation_id: 'cursor-session',
      hook_event_name: 'beforeSubmitPrompt',
      workspace_roots: ['/fixture/atlas'],
      model_id: 'grok-code-fast-1',
      prompt: 'PRIVATE_PROMPT',
      tool_input: { command: 'PRIVATE_COMMAND' },
    };
    expect((await post(endpoint!, payload)).status).toBe(401);
    expect((await post(endpoint!, payload, token!, 'text/plain')).status).toBe(415);
    expect((await post(endpoint!, payload, token!)).status).toBe(204);
    const linked = service.enrich(snapshot(repository()));
    expect(linked.repositories[0].branches[0].tasks).toEqual([
      expect.objectContaining({
        id: 'cursor-session',
        tool: 'cursor',
        association: 'verified',
        status: 'active',
        activitySource: 'cursor-hook',
        model: { id: 'grok-code-fast-1', provider: 'xai' },
      }),
    ]);
    expect(JSON.stringify(linked)).not.toMatch(/PRIVATE|prompt|command/);
    const wrongHead = repository();
    wrongHead.worktrees[0].head = 'b'.repeat(40);
    wrongHead.branches[0].worktrees = wrongHead.worktrees;
    expect(service.enrich(snapshot(wrongHead)).repositories[0].branches[0].tasks).toEqual([]);
    expect(
      (
        await post(
          endpoint!,
          { ...payload, workspace_roots: ['/fixture/atlas', '/fixture/relay'] },
          token!,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await fetch(endpoint!, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ...payload, padding: 'x'.repeat(33 * 1024) }),
        })
      ).status,
    ).toBe(413);
    expect((await post(endpoint!, { ...payload, hook_event_name: 'stop' }, token!)).status).toBe(
      204,
    );
    expect(
      service.enrich(snapshot(repository())).repositories[0].branches[0].tasks?.[0],
    ).toMatchObject({
      status: 'idle',
      activitySource: 'cursor-hook',
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 91_000);
    expect(service.enrich(snapshot(repository())).repositories[0].branches[0].tasks).toEqual([]);
    await service.setEnabled('claude-code', true);
    await service.setEnabled('cursor', false);
    expect(service.statuses().find((status) => status.tool === 'cursor')).toMatchObject({
      enabled: false,
      installed: false,
      state: 'not-connected',
      activeCount: 0,
    });
    expect((await post(endpoint!, payload, token!)).status).toBe(403);
    await service.setEnabled('claude-code', false);
  });

  it('accepts an opted-in Codex hook as verified live activity', async () => {
    const home = await directory();
    const store = new AppStore(join(home, 'store'));
    const service = new LiveAgentService(store, vi.fn(), new AgentHookInstaller(home), 0);
    cleanup.push(async () => {
      await service.close();
      store.close();
    });
    await service.setEnabled('codex', true);
    const script = await readFile(join(home, '.codex', 'openbranches-live.sh'), 'utf8');
    const endpoint = script.match(/'(http:\/\/127\.0\.0\.1:\d+\/v1\/events\/codex)'/)?.[1];
    const token = script.match(/Authorization: Bearer ([a-f\d]{64})/)?.[1];
    expect(
      (
        await post(
          endpoint!,
          {
            session_id: 'codex-session',
            cwd: '/fixture/atlas',
            hook_event_name: 'UserPromptSubmit',
            model: 'gpt-6-astra',
            prompt: 'PRIVATE_PROMPT',
          },
          token!,
        )
      ).status,
    ).toBe(204);
    expect(service.enrich(snapshot(repository())).repositories[0].branches[0].tasks).toEqual([
      expect.objectContaining({
        id: 'codex-session',
        tool: 'codex',
        association: 'verified',
        status: 'active',
        activitySource: 'codex-hook',
        model: { id: 'gpt-6-astra', provider: 'openai' },
      }),
    ]);
  });
});

function repository(): Repository {
  const sha = 'a'.repeat(40);
  const scannedAt = new Date().toISOString();
  const worktree = {
    path: '/fixture/atlas',
    head: sha,
    branch: 'feat/live',
    detached: false,
    available: true,
    dirty: false,
    changedFiles: 0,
  };
  return {
    id: 'atlas',
    name: 'Atlas',
    path: worktree.path,
    commonDir: worktree.path + '/.git',
    targets: [{ name: 'develop', sha: 'd'.repeat(40), source: 'local' }],
    branches: [
      {
        id: 'live',
        repositoryId: 'atlas',
        name: 'feat/live',
        title: 'Live',
        local: {
          name: 'feat/live',
          fullName: 'refs/heads/feat/live',
          sha,
          updatedAt: scannedAt,
          subject: 'Live work',
        },
        worktrees: [worktree],
        updatedAt: scannedAt,
        integration: { develop: 'pending' },
        codexNamed: false,
        detached: false,
        tasks: [],
      },
    ],
    worktrees: [worktree],
    remotes: [],
    scannedAt,
    shallow: false,
  };
}

function snapshot(repository: Repository): Snapshot {
  return {
    repositories: [repository],
    events: [],
    updatedAt: repository.scannedAt,
    scanning: false,
  };
}

function post(endpoint: string, body: unknown, token?: string, contentType = 'application/json') {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': contentType,
    },
    body: JSON.stringify(body),
  });
}
