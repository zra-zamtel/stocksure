import type { SQLiteDatabase } from 'expo-sqlite';
import { migrations } from './schema';
import { seedDemoShop } from './seed';

/**
 * Runs before any screen renders (SQLiteProvider onInit). Connection pragmas go
 * outside the transaction; schema changes and the version bump go inside it, so
 * a failed migration rolls back both and the phone is never half-upgraded.
 */
export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current > migrations.length) {
    throw new Error(
      `Database schema v${current} is newer than this build supports (v${migrations.length}).`
    );
  }

  for (let version = current; version < migrations.length; version += 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migrations[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1};`);
    });
  }

  await seedDemoShop(db);
}
