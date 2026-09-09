import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Snapshot } from '../../src/domain/types';

export class AppStore {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'openbranches.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;',
    );
  }
  read<T>(key: string, fallback: T): T {
    try {
      const value = this.readStrict(key);
      return value === undefined ? fallback : (value as T);
    } catch {
      return fallback;
    }
  }
  readStrict(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  write(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  snapshot(): Snapshot {
    return this.read('snapshot', {
      repositories: [],
      events: [],
      updatedAt: new Date().toISOString(),
      scanning: false,
    });
  }
  close(): void {
    this.db.close();
  }
}
