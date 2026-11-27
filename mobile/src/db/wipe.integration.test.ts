import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueSync } from './repos';
import { wipeLocalShop } from './wipe';
import { count, openTestDb, type TestDb } from '@/test/sqlite';

let db: TestDb;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  db.close();
});

describe('IT-WIPE hand over this phone', () => {
  it('empties every table but keeps the schema, like a fresh install', async () => {
    const stamp = '2026-11-27T08:00:00Z';
    await db.runAsync(
      `INSERT INTO owner (id, name, phone, email, pin_hash, created_at, updated_at)
       VALUES ('owner_1', 'Elton', '260971234567', 'e@example.com', 'hash', ?, ?)`,
      stamp,
      stamp
    );
    await enqueueSync(db, 'shop', 'shop_1', 'create', { id: 'shop_1' });
    await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '12')`);
    const versionBefore = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');

    await wipeLocalShop(db);

    expect(await count(db, 'owner')).toBe(0);
    expect(await count(db, 'sync_queue')).toBe(0);
    expect(await count(db, 'sync_meta')).toBe(0);
    const versionAfter = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(versionAfter?.user_version).toBe(versionBefore?.user_version);
    // Foreign keys are back on for everything that follows.
    const fk = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
  });
});
