import { spawn, execFile } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
const image =
  'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2';
let ownedContainer;

async function docker(args, options = {}) {
  return (
    await exec('docker', args, { cwd: root, timeout: 60_000, maxBuffer: 1024 * 1024, ...options })
  ).stdout.trim();
}
async function database() {
  if (process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL)
    return process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL;
  const password = randomBytes(32).toString('hex');
  const name = 'openbranches-test-' + randomUUID();
  process.stdout.write('Starting an isolated PostgreSQL test container on loopback.\n');
  // The password is transient and passed through the environment, never logged.
  const id = await docker(
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--label',
      'openbranches.purpose=team-service-test',
      '--tmpfs',
      '/var/lib/postgresql:rw,size=512m',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_DB=openbranches_test',
      image,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password } },
  );
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Could not identify the test container.');
  ownedContainer = id;
  const published = await docker(['port', id, '5432/tcp']);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(published)?.[1];
  if (!port) throw new Error('The test database must listen on loopback only.');
  for (let attempt = 0; attempt < 80; attempt++) {
    abort.signal.throwIfAborted();
    try {
      await docker(['exec', id, 'pg_isready', '-U', 'postgres', '-d', 'openbranches_test'], {
        timeout: 3000,
      });
      return `postgresql://postgres:${password}@127.0.0.1:${port}/openbranches_test`;
    } catch {
      await delay(250, undefined, { signal: abort.signal });
    }
  }
  throw new Error('The isolated PostgreSQL test container did not become ready.');
}
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
  process.exitCode = await tests(await database());
} catch {
  process.stderr.write(
    'Team tests could not finish. Install the team dependencies and start Docker, or supply a dedicated test database URL.\n',
  );
  process.exitCode = 1;
} finally {
  if (ownedContainer) {
    try {
      await docker(['stop', '--time', '5', ownedContainer], { timeout: 15_000 });
    } catch {
      process.stderr.write(
        'Could not stop the test container ' +
          ownedContainer +
          '. Stop this container before retrying.\n',
      );
      process.exitCode = 1;
    }
  }
}
