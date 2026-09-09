import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { teamTestDatabase } from './team-test-database.mjs';
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
let fixture;
try {
  fixture = await teamTestDatabase({ signal: abort.signal });
  await build({
    entryPoints: ['team-service/dev/preview.ts'],
    outfile: 'team-service/dist/preview.mjs',
    platform: 'node',
    format: 'esm',
    bundle: true,
    target: 'node24',
    external: ['pg'],
  });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['team-service/dist/preview.mjs'], {
      stdio: 'inherit',
      signal: abort.signal,
      env: {
        ...process.env,
        OPENBRANCHES_TEAM_PREVIEW_DATABASE_URL: fixture.url,
        OPENBRANCHES_TEAM_FICTIONAL_PREVIEW: '1',
      },
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });
} catch (error) {
  if (!abort.signal.aborted) {
    process.stderr.write(
      'The fictional preview could not start. Build the team UI, install team dependencies, and start Docker.\n',
    );
    process.exitCode = 1;
  }
} finally {
  try {
    await fixture?.close();
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
