import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildElectron } from './build.mjs';
import { buildIcons } from './icons.mjs';
await buildIcons();
await buildElectron();
const vite = await createServer();
await vite.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, OPENBRANCHES_DEV_URL: 'http://127.0.0.1:5173' },
});
child.on('exit', async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
