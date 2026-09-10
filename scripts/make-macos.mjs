import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { macArguments } from './macos-artifacts.mjs';

if (process.platform !== 'darwin') throw new Error('Mac packaging requires macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { architecture, release } = macArguments(process.argv.slice(2));
const environment = {
  ...process.env,
  OPENBRANCHES_SIGN_RELEASE: release ? '1' : '0',
};
const run = (file, args) =>
  execFileSync(file, args, { cwd: root, env: environment, stdio: 'inherit' });

run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
run(process.execPath, [join(root, 'scripts/build.mjs')]);
run(process.execPath, [
  join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'),
  'package',
  '--platform=darwin',
  `--arch=${architecture}`,
]);
run(process.execPath, [
  join(root, 'scripts/make-dmg.mjs'),
  `--arch=${architecture}`,
  ...(release ? ['--release'] : []),
]);
