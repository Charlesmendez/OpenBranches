import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';

export class TeamDatabase {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      application_name: 'openbranches-team',
    });
    this.pool.on('error', () => {
      /* Request handlers report availability without logging credentials. */
    });
  }
  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
  async migrate() {
    const sql = await readFile(new URL('../migrations/001-team.sql', import.meta.url), 'utf8');
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(826041920)');
      await client.query(sql);
    });
  }
  close() {
    return this.pool.end();
  }
}
