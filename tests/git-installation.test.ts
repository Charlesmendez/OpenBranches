import { describe, expect, it, vi } from 'vitest';
import {
  discoverGit,
  GitInstallation,
  gitEnvironment,
  gitVersion,
  type GitDiscovery,
} from '../electron/git/installation';

function fixture(entries: Record<string, string>, tools = false) {
  const calls: [string, string[]][] = [];
  return {
    platform: 'darwin',
    searchPath: '/usr/bin:.:relative:/fixture/bin',
    calls,
    async executablePath(path: string) {
      if (
        path === '/usr/bin/git' ||
        path in entries ||
        (tools && path === '/fixture/developer/usr/bin/git')
      )
        return path;
      if (path === '/fixture/bin/git') return '/usr/bin/git'; // Another symlink to Apple's shim.
      return undefined;
    },
    async run(path: string, args: string[]) {
      calls.push([path, args]);
      if (path === '/usr/bin/xcode-select' && tools) return '/fixture/developer\n';
      if (!(path in entries)) throw new Error('unavailable: private machine detail');
      return entries[path];
    },
  };
}

describe('Git setup on Mac', () => {
  it('does not invoke the Apple Git shim or installer when tools are missing, including a PATH alias', async () => {
    const probe = fixture({});
    expect(await discoverGit(probe)).toMatchObject({
      status: { state: 'missing', installAvailable: true },
    });
    expect(probe.calls).toEqual([['/usr/bin/xcode-select', ['--print-path']]]);
  });
  it('finds a Homebrew binary outside a Finder launch PATH and returns its absolute path', async () => {
    const probe = fixture({ '/opt/homebrew/bin/git': 'git version 2.53.0\n' });
    expect(await discoverGit(probe)).toEqual({
      status: { state: 'ready', version: '2.53.0', installAvailable: false },
      executable: '/opt/homebrew/bin/git',
    });
    expect(probe.calls).not.toContainEqual(['/usr/bin/git', ['--version']]);
  });
  it('uses Apple Git only after finding the selected developer tools, and explains unsupported versions', async () => {
    const ready = fixture({ '/usr/bin/git': 'git version 2.50.1 (Apple Git-155)' }, true);
    expect(await discoverGit(ready)).toMatchObject({
      status: { state: 'ready', version: '2.50.1' },
      executable: '/usr/bin/git',
    });
    const old = fixture({ '/usr/bin/git': 'git version 2.35.0 (Apple Git-100)' }, true);
    expect(await discoverGit(old)).toMatchObject({
      status: { state: 'unsupported', version: '2.35.0', installAvailable: false },
    });
    expect(gitVersion('git version 2.36.0')).toMatchObject({ supported: true });
    expect(gitVersion('git version 2.36.0-rc1')).toBeUndefined();
    expect(gitVersion('some wrapper: git version 2.50.0')).toBeUndefined();
  });
  it('reports a broken or unlicensed installation without exposing command output', async () => {
    const result = await discoverGit(fixture({}, true));
    expect(result.status).toMatchObject({ state: 'unavailable', installAvailable: false });
    expect(JSON.stringify(result)).not.toContain('private machine detail');
  });
  it('removes inherited repository and config overrides while retaining ordinary process environment', () => {
    expect(
      gitEnvironment({
        PATH: '/usr/bin',
        LANG: 'en_US.UTF-8',
        GIT_DIR: '/other/repo/.git',
        GIT_WORK_TREE: '/other/repo',
        GIT_INDEX_FILE: '/private/index',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'alias.status',
        GIT_CONFIG_VALUE_0: '!touch private',
      }),
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    });
  });
  it('coalesces checks and installation requests; never installs during normal inspection', async () => {
    const install = vi.fn(async () => {});
    const discover = vi.fn<() => Promise<GitDiscovery>>(async () => ({
      status: { state: 'missing' as const, installAvailable: true, message: 'Set up Git.' },
    }));
    const service = new GitInstallation(() => {}, discover, install);
    const first = service.check();
    expect(service.check(true)).toBe(first);
    await first;
    await expect(service.executable()).rejects.toThrow('Set up Git.');
    expect(install).not.toHaveBeenCalled();
    const requested = service.requestInstall();
    expect(service.requestInstall()).toBe(requested);
    await requested;
    expect(install).toHaveBeenCalledTimes(1);
    expect(service.status().state).toBe('missing'); // Opening an installer is not success.
    discover.mockResolvedValue({
      status: { state: 'ready', version: '2.53.0', installAvailable: false },
      executable: '/fixture/git',
    });
    await service.check(true);
    expect(await service.executable()).toBe('/fixture/git');
    await service.requestInstall();
    expect(install).toHaveBeenCalledTimes(1);
  });
  it('keeps failed installs retryable and refuses an install when tools are already present', async () => {
    const install = vi.fn(async () => {
      throw new Error('private diagnostics');
    });
    const service = new GitInstallation(
      () => {},
      async () => ({ status: { state: 'missing', installAvailable: true } }),
      install,
    );
    await expect(service.requestInstall()).rejects.toThrow('Apple’s installer could not be opened');
    await expect(service.requestInstall()).rejects.toThrow('Apple’s installer could not be opened');
    expect(install).toHaveBeenCalledTimes(2);
    const unavailable = new GitInstallation(
      () => {},
      async () => ({ status: { state: 'unavailable', installAvailable: false } }),
      install,
    );
    await expect(unavailable.requestInstall()).rejects.toThrow('Open Apple’s setup guide');
    expect(install).toHaveBeenCalledTimes(2);
  });
});
