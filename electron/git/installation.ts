import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitStatus } from '../../src/domain/types';

const exec = promisify(execFile);
export const GIT_SETUP_GUIDE =
  'https://developer.apple.com/documentation/xcode/installing-the-command-line-tools';
export const GIT_MINIMUM_VERSION = '2.36.0';

// A launcher may inherit Git's repository/config overrides from another tool.
// Always inspect the folder the user selected, with our own read-only options.
export function gitEnvironment(environment = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
}
const run = async (path: string, args: string[]) => {
  const { stdout } = await exec(path, args, {
    cwd: tmpdir(),
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 4096,
    env: gitEnvironment(),
  });
  return stdout;
};
interface Probe {
  platform: string;
  searchPath: string;
  executablePath(path: string): Promise<string | undefined>;
  run(path: string, args: string[]): Promise<string>;
}
const system: Probe = {
  platform: process.platform,
  searchPath: process.env.PATH ?? '',
  run,
  async executablePath(path) {
    try {
      await access(path, constants.X_OK);
      return await realpath(path);
    } catch {
      return undefined;
    }
  },
};
export interface GitDiscovery {
  status: GitStatus;
  executable?: string;
}

export function gitVersion(output: string): { version: string; supported: boolean } | undefined {
  const match = /^git version (\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output.trim());
  if (!match) return undefined;
  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    supported: Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 36),
  };
}

export async function discoverGit(probe: Probe = system): Promise<GitDiscovery> {
  let appleToolsReady = false;
  if (probe.platform === 'darwin') {
    try {
      const directory = (await probe.run('/usr/bin/xcode-select', ['--print-path'])).trim();
      appleToolsReady =
        isAbsolute(directory) && !!(await probe.executablePath(join(directory, 'usr/bin/git')));
    } catch {
      /* The Apple Git shim must not launch an installer during detection. */
    }
  }
  const installAvailable = probe.platform === 'darwin' && !appleToolsReady;
  const candidates = new Set([
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/usr/bin/git',
    ...probe.searchPath
      .split(':')
      .filter(isAbsolute)
      .slice(0, 32)
      .map((path) => join(path, 'git')),
  ]);
  const seen = new Set<string>();
  let unsupported: string | undefined;
  let failed = false;
  // At most four installed binaries are executed, with a three-second timeout each.
  for (const candidate of candidates) {
    const path = await probe.executablePath(candidate);
    if (!path || seen.has(path)) continue;
    if (probe.platform === 'darwin' && path === '/usr/bin/git' && !appleToolsReady) continue;
    if (seen.size >= 4) break;
    seen.add(path);
    try {
      const parsed = gitVersion(await probe.run(path, ['--version']));
      if (parsed?.supported)
        return {
          status: { state: 'ready', version: parsed.version, installAvailable: false },
          executable: path,
        };
      if (parsed) unsupported ??= parsed.version;
      else failed = true;
    } catch {
      failed = true;
    }
  }
  if (unsupported)
    return {
      status: {
        state: 'unsupported',
        version: unsupported,
        installAvailable,
        message: `OpenBranches needs Git ${GIT_MINIMUM_VERSION} or newer to read worktree paths reliably. Update Git or Apple’s Command Line Tools, then check again.`,
      },
    };
  if (failed || appleToolsReady)
    return {
      status: {
        state: 'unavailable',
        installAvailable,
        message:
          'Git is installed but could not be started. Apple’s setup guide can help repair the tools or finish their setup.',
      },
    };
  return {
    status: {
      state: 'missing',
      installAvailable,
      message:
        'Git reads the branch history in your projects. Apple includes it in a free package called Command Line Tools.',
    },
  };
}

export class GitInstallation {
  private result?: GitDiscovery;
  private checkedAt = 0;
  private checking?: Promise<GitStatus>;
  private installing?: Promise<void>;
  constructor(
    private publish: (status: GitStatus) => void,
    private discover: () => Promise<GitDiscovery> = discoverGit,
    private install: () => Promise<unknown> = () => run('/usr/bin/xcode-select', ['--install']),
  ) {}
  status(): GitStatus {
    return this.result?.status ?? { state: 'checking', installAvailable: false };
  }
  check(force = false): Promise<GitStatus> {
    if (this.checking) return this.checking;
    if (!force && this.result && Date.now() - this.checkedAt < 30_000)
      return Promise.resolve(this.status());
    this.checking = this.discover()
      .then((result) => {
        this.result = result;
      })
      .catch(() => {
        this.result = {
          status: {
            state: 'unavailable',
            installAvailable: false,
            message: 'Git could not be checked. Try again or open Apple’s setup guide.',
          },
        };
      })
      .then(() => {
        this.checkedAt = Date.now();
        this.publish(this.status());
        return this.status();
      })
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }
  async executable(): Promise<string> {
    await this.check();
    if (this.result?.status.state !== 'ready' || !this.result.executable)
      throw new Error(this.status().message ?? 'Set up Git before adding a project.');
    return this.result.executable;
  }
  requestInstall(): Promise<void> {
    if (this.installing) return this.installing;
    this.installing = (async () => {
      const status = await this.check(true);
      if (status.state === 'ready') return;
      if (!status.installAvailable)
        throw new Error('Open Apple’s setup guide to finish configuring Git, then check again.');
      try {
        await this.install();
      } catch {
        throw new Error(
          'Apple’s installer could not be opened. If installation is already in progress, let it finish and check again. Otherwise, open the setup guide.',
        );
      }
    })().finally(() => {
      this.installing = undefined;
    });
    return this.installing;
  }
}
