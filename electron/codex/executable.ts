import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export interface CodexExecutable {
  path: string;
  version: string;
  supported: boolean;
}

export function supportedVersion(version: string) {
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version);
  // 0.144.4 is the first protocol version verified by this integration.
  return (
    !!match &&
    Number(match[1]) === 0 &&
    (Number(match[2]) > 144 || (Number(match[2]) === 144 && Number(match[3]) >= 4))
  );
}

export async function findCodex(): Promise<CodexExecutable | undefined> {
  const candidates = new Set([
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    join(homedir(), '.local/bin/codex'),
    '/Applications/Codex.app/Contents/Resources/codex',
    join(homedir(), 'Applications/Codex.app/Contents/Resources/codex'),
    ...(process.env.PATH ?? '')
      .split(':')
      .filter(isAbsolute)
      .map((path) => join(path, 'codex')),
  ]);
  let unsupported: CodexExecutable | undefined;
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      const { stdout } = await exec(path, ['--version'], { timeout: 3000, maxBuffer: 4096 });
      const version = stdout.trim();
      if (!/^codex-cli \d+\.\d+\.\d+/.test(version)) continue;
      const result = { path, version, supported: supportedVersion(version) };
      if (result.supported) return result;
      unsupported ??= result;
    } catch {
      /* Optional integration; continue to other standard install locations. */
    }
  }
  return unsupported;
}
