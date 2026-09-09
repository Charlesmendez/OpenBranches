import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { createServer } from 'vite';
import electron from 'electron';
if (process.platform !== 'darwin') throw new Error('The native team preview requires macOS.');
const directory = await mkdtemp(join(tmpdir(), 'openbranches-team-native-'));
let server, child;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child?.kill('SIGTERM');
};
// npm and the terminal may both deliver a signal. Keep handlers installed while
// the copied app is being removed so a second signal cannot interrupt cleanup.
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const checkRunning = () => {
  if (stopping) throw new Error('Preview stopped.');
};
try {
  await mkdir(join(directory, 'userdata'));
  // A distinct bundle avoids selecting another running Electron workspace in
  // macOS accessibility tools. The installed runtime remains unchanged.
  const application = join(directory, 'OpenBranches Team Preview.app');
  await cp(dirname(dirname(dirname(electron))), application, {
    recursive: true,
    verbatimSymlinks: true,
  });
  checkRunning();
  const plist = join(application, 'Contents/Info.plist');
  const exec = promisify(execFile);
  await exec('/usr/bin/plutil', [
    '-replace',
    'CFBundleIdentifier',
    '-string',
    'com.openbranches.team-preview',
    plist,
  ]);
  await exec('/usr/bin/plutil', [
    '-replace',
    'CFBundleName',
    '-string',
    'OpenBranches Team Preview',
    plist,
  ]);
  await exec('/usr/bin/plutil', [
    '-replace',
    'CFBundleDisplayName',
    '-string',
    'OpenBranches Team Preview',
    plist,
  ]);
  await build({
    entryPoints: { main: 'tests/native/team.ts', preload: 'tests/native/preload.ts' },
    outdir: directory,
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    bundle: true,
    target: 'node24',
    external: ['electron'],
  });
  checkRunning();
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  checkRunning();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  process.stdout.write(
    'Native preview uses fictional repositories and its own temporary storage. Start team:preview separately, then enter its loopback address in the app.\n',
  );
  process.stdout.write('Native fixture application: ' + application + '\n');
  do {
    checkRunning();
    child = spawn(join(application, 'Contents/MacOS/Electron'), [join(directory, 'main.cjs')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        OPENBRANCHES_NATIVE_TEAM_FIXTURE: '1',
        OPENBRANCHES_NATIVE_TEAM_UI: `http://127.0.0.1:${address.port}/tests/ui/team-native.html`,
      },
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 0));
    });
    if (process.exitCode === 75 && !stopping)
      process.stdout.write(
        'Restarting the fictional Mac process with the same isolated storage.\n',
      );
  } while (process.exitCode === 75 && !stopping);
} catch (error) {
  if (!stopping) throw error;
} finally {
  try {
    await server?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
