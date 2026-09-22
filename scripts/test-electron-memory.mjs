import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stage = await mkdtemp(join(tmpdir(), 'openbranches-electron-memory-'));
try {
  const entry = join(stage, 'memory-probe.cjs');
  await build({
    stdin: {
      contents: `
        const { app } = require('electron');
        const { releaseUnusedMemory } = require('./electron/services/memory');
        app.setPath('userData', ${JSON.stringify(join(stage, 'profile'))});
        app.whenReady().then(async () => {
          for (let round = 0; round < 3; round++) {
            releaseUnusedMemory(true);
            await new Promise(resolve => setTimeout(resolve, 250));
            console.log('memory-cleanup-responsive:' + round);
          }
          app.exit(0);
        });
      `,
      resolveDir: root,
      sourcefile: 'electron-memory-probe.cjs',
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const { stdout } = await promisify(execFile)(electron, [entry], {
    env,
    timeout: 15_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  for (let round = 0; round < 3; round++) {
    assert.ok(stdout.includes(`memory-cleanup-responsive:${round}`));
  }
  console.log('Electron main process remained responsive after three memory cleanups.');
} finally {
  await rm(stage, { recursive: true, force: true });
}
