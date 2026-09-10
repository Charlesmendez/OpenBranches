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
    const sql = await Promise.all(
      [
        '001-team.sql',
        '002-github.sql',
        '003-github-sync.sql',
        '004-attention.sql',
        '005-local-attention.sql',
      ].map((name) => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')),
    );
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(826041920)');
      for (const migration of sql) await client.query(migration);
    });
  }
  close() {
    return this.pool.end();
  }
}
