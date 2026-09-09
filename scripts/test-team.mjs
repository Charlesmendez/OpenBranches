import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { teamTestDatabase } from './team-test-database.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
let fixture;
async function tests(url) {
  abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--config', 'team-service/vitest.config.mts'],
      {
        cwd: root,
        stdio: 'inherit',
        signal: abort.signal,
        env: { ...process.env, OPENBRANCHES_TEAM_TEST_DATABASE_URL: url },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
try {
  fixture = await teamTestDatabase({
    signal: abort.signal,
    existing: process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL,
  });
  process.exitCode = await tests(fixture.url);
} catch {
  process.stderr.write(
    'Team tests could not finish. Install the team dependencies and start Docker, or supply a dedicated test database URL.\n',
  );
  process.exitCode = 1;
} finally {
  try {
    await fixture?.close();
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
