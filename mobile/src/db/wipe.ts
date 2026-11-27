import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Empties every table on this phone, keeping the schema (and its version), so
 * the next person starts exactly like a fresh install. Tables are read from
 * the database itself, so one added by a later migration is cleared too.
 *
 * Only call this once the outbox is empty: rows still waiting to upload would
 * be lost for good.
 */
export async function wipeLocalShop(db: SQLiteDatabase): Promise<void> {
  const tables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  );
  // Foreign keys would make the delete order matter; this pragma cannot change
  // inside a transaction, so it is switched off around it.
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      for (const { name } of tables) {
        await db.execAsync(`DELETE FROM "${name.replace(/"/g, '""')}";`);
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}
