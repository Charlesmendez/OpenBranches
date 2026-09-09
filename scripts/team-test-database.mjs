import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
const docker = async (args, options = {}) =>
  (
    await exec('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024, ...options })
  ).stdout.trim();
export async function teamTestDatabase({ signal, existing } = {}) {
  if (existing) return { url: existing, close: async () => {} };
  const password = randomBytes(32).toString('hex'),
    name = 'openbranches-test-' + randomUUID();
  let owned;
  const close = async () => {
    if (!owned) return;
    const id = owned;
    try {
      await docker(['stop', '--time', '5', id], { timeout: 15000 });
      owned = undefined;
    } catch {
      throw new Error('Could not stop the test container ' + id);
    }
  };
  try {
    signal?.throwIfAborted();
    process.stdout.write('Starting an isolated PostgreSQL fixture on loopback.\n');
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
        'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2',
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password } },
    );
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Could not identify the fixture container.');
    owned = id;
    const port = /^127\.0\.0\.1:(\d+)$/.exec(await docker(['port', id, '5432/tcp']))?.[1];
    if (!port) throw new Error('The fixture must listen on loopback only.');
    for (let attempt = 0; attempt < 80; attempt++) {
      signal?.throwIfAborted();
      try {
        await docker(['exec', id, 'pg_isready', '-U', 'postgres', '-d', 'openbranches_test'], {
          timeout: 3000,
        });
        return {
          url: `postgresql://postgres:${password}@127.0.0.1:${port}/openbranches_test`,
          close,
        };
      } catch {
        await delay(250, undefined, { signal });
      }
    }
    throw new Error('The fixture database did not become ready.');
  } catch (error) {
    await close();
    throw error;
  }
}
