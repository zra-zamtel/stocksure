import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { initializeDatabase } from '@/db/migrate';

/**
 * A real SQLite database for integration and system tests, shaped like the
 * slice of expo-sqlite that the data layer uses. The SQL, the schema, the
 * constraints and the transactions are the real ones; only the driver differs,
 * so repos.ts runs unchanged in Node.
 */
class TestDatabase {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
  }

  async execAsync(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const result = this.raw.prepare(sql).run(...bind(params));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    const row = this.raw.prepare(sql).get(...bind(params));
    return row ? ({ ...row } as T) : null;
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...bind(params)).map((row) => ({ ...row }) as T);
  }

  /** Same contract as expo-sqlite: commit on success, roll back and rethrow on failure. */
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.raw.exec('BEGIN');
    try {
      await task();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}

/** expo-sqlite accepts either variadic params or one array; support both. */
function bind(params: unknown[]): SQLInputValue[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value as SQLInputValue;
  });
}

export type TestDb = SQLiteDatabase & { raw: DatabaseSync; close(): void };

/** An empty database, without migrations. */
export function openBlankDb(): TestDb {
  return new TestDatabase() as unknown as TestDb;
}

/** A fresh install: migrations applied, no shop yet. */
export async function openTestDb(): Promise<TestDb> {
  const db = openBlankDb();
  await initializeDatabase(db);
  return db;
}

export async function count(db: TestDb, table: string, where = '1 = 1', ...params: unknown[]): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
    ...(params as string[])
  );
  return row?.n ?? 0;
}

export async function stockOf(db: TestDb, variantId: string): Promise<number> {
  const row = await db.getFirstAsync<{ quantity: number }>(
    'SELECT quantity FROM variant_stock WHERE variant_id = ?',
    variantId
  );
  return row?.quantity ?? 0;
}

/** A local time on a given shop day, as the phone would stamp it (Lusaka, UTC+2). */
export function at(day: string, time: string): string {
  return `${day}T${time}:00+02:00`;
}
