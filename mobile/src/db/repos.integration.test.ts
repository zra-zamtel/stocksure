import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from './migrate';
import { migrations } from './schema';
import {
  completeOnboarding,
  createOwner,
  createProduct,
  createProductWithVariants,
  expiringVariants,
  createStaff,
  ensureTaxPeriod,
  findVariantByBarcode,
  getOnboardingState,
  getOwner,
  getSaleDetail,
  getShop,
  getTaxPotView,
  ignorePayment,
  injectDemoMessages,
  InsufficientStockError,
  listIdentities,
  listMovements,
  listProductsWithStock,
  listSales,
  listStaff,
  lowStockVariants,
  markSalePaid,
  markStaffFirstSignIn,
  payTaxPot,
  reconcileDay,
  addPaymentMessage,
  DuplicateMessageError,
  recordSale,
  restockVariant,
  saveCashCount,
  saveMoneySettings,
  saveShopDetails,
  setVariantBarcode,
  taxSnapshot,
  topUpTaxPot,
  totalsForDay,
  updateOwnerPinHash,
  updateStaffPinHash,
  upsertOwnerFromServer,
  upsertStaffFromServer,
  voidSale,
  type RecordSaleInput,
} from './repos';
import { isInStoreBarcode, type TaxRules } from '@/core';
import { at, count, openBlankDb, openTestDb, stockOf, type TestDb } from '@/test/sqlite';

/**
 * Integration tests: the data layer against a real SQLite database with the
 * real migrations. Each test checks what lands in the tables, including the
 * sync outbox, not just what a function returns.
 */

const DAY = '2026-11-17';
const rules: TaxRules = {
  version: 1,
  rate: 0.04,
  threshold: 80_000_000,
  thresholdBasis: 'period',
  periodDays: 30,
  dueDaysAfterPeriod: 14,
  reminderDaysBefore: [7, 3, 0],
};

let db: TestDb;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => db.close());

async function shop(usesBarcodes = false) {
  await saveShopDetails(db, { name: 'Chiwala Fashions', profileId: 'fashion', town: 'Lusaka', language: 'en', usesBarcodes });
}

async function product(openingQuantity = 10, extra: Partial<Parameters<typeof createProduct>[1]> = {}) {
  return createProduct(db, { name: 'School shirt', buyPrice: 5000, sellPrice: 8000, openingQuantity, ...extra });
}

function cashSale(variantId: string, quantity = 1, createdAt = at(DAY, '10:00')): RecordSaleInput {
  return {
    recordedBy: 'staff-1',
    createdAt,
    lines: [{ variantId, quantity, buyPrice: 5000, sellPrice: 8000 }],
    payments: [{ method: 'cash', amount: 8000 * quantity }],
  };
}

function mobileSale(variantId: string, createdAt = at(DAY, '10:00'), reference?: string): RecordSaleInput {
  return {
    recordedBy: 'staff-1',
    createdAt,
    lines: [{ variantId, quantity: 1, buyPrice: 5000, sellPrice: 8000 }],
    payments: [{ method: 'mobile_money', amount: 8000, provider: 'MTN', reference }],
  };
}

async function message(amount: number, receivedAt: string, reference: string | null = null, provider = 'MTN') {
  const id = `mm_${Math.random().toString(36).slice(2)}`;
  await db.runAsync(
    `INSERT INTO mobile_money_txn (id, provider, amount, sender, reference, received_at, raw_message, parsed, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Customer', ?, ?, 'raw', 1, 'unmatched', ?, ?)`,
    id,
    provider,
    amount,
    reference,
    receivedAt,
    receivedAt,
    receivedAt
  );
  return id;
}

async function saleStatus(saleId: string) {
  return (await db.getFirstAsync<{ s: string }>('SELECT reconcile_status AS s FROM sale WHERE id = ?', saleId))?.s;
}

async function txnStatus(txnId: string) {
  return (await db.getFirstAsync<{ s: string }>('SELECT status AS s FROM mobile_money_txn WHERE id = ?', txnId))?.s;
}

describe('IT-DB migrations and schema', () => {
  it('IT-DB-01 brings a fresh database to the latest version', async () => {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(migrations.length);
  });

  it('IT-DB-02 is safe to run again on every app start', async () => {
    await initializeDatabase(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(migrations.length);
  });

  it('IT-DB-03 refuses a database from a newer build', async () => {
    await db.execAsync(`PRAGMA user_version = ${migrations.length + 1}`);
    await expect(initializeDatabase(db)).rejects.toThrow(/newer than this build/);
  });

  it('IT-DB-04 rolls back a failed migration so the phone is never half-upgraded', async () => {
    const blank = openBlankDb();
    migrations.push('CREATE TABLE broken (;');
    try {
      await expect(initializeDatabase(blank)).rejects.toThrow();
      const row = await blank.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      expect(row?.user_version).toBe(migrations.length - 1);
    } finally {
      migrations.pop();
      blank.close();
    }
  });

  it('IT-DB-04b upgrades a v9 phone and backfills each shop profile from its type', async () => {
    const old = openBlankDb();
    try {
      await old.execAsync('PRAGMA foreign_keys = ON;');
      for (let version = 0; version < 9; version += 1) await old.execAsync(migrations[version]);
      await old.execAsync('PRAGMA user_version = 9;');
      const insert = (id: string, type: string) =>
        old.runAsync(
          `INSERT INTO shop (id, name, type, town, created_at, updated_at) VALUES (?, 'Shop', ?, 'Lusaka', 'x', 'x')`,
          id,
          type
        );
      await insert('s_clothes', 'clothes');
      await insert('s_shoes', 'shoes');
      await insert('s_general', 'general');
      await insert('s_other', 'other');

      await initializeDatabase(old);

      const rows = await old.getAllAsync<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM shop ORDER BY id'
      );
      expect(rows).toEqual([
        { id: 's_clothes', profile_id: 'fashion' },
        { id: 's_general', profile_id: 'general' },
        { id: 's_other', profile_id: 'general' },
        { id: 's_shoes', profile_id: 'fashion' },
      ]);
    } finally {
      old.close();
    }
  });

  it('IT-DB-05 rejects a zero stock movement and an unknown reason', async () => {
    const { variantId } = await product();
    const insert = (qty: number, reason: string) =>
      db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'x', 'x')`,
        `m${Math.random()}`,
        variantId,
        qty,
        reason
      );
    await expect(insert(0, 'restock')).rejects.toThrow();
    await expect(insert(1, 'theft')).rejects.toThrow();
  });

  it('IT-DB-06 keeps barcodes unique but allows many products without one', async () => {
    await product(1, { barcode: '6001234500018' });
    await product(1, { name: 'No code A' });
    await product(1, { name: 'No code B' });
    await expect(
      db.runAsync(
        `INSERT INTO product_variant (id, product_id, barcode, buy_price, sell_price, created_at, updated_at)
         SELECT 'dup', product_id, '6001234500018', 0, 0, 'x', 'x' FROM product_variant LIMIT 1`
      )
    ).rejects.toThrow();
  });

  it('IT-DB-07 refuses a stock movement for a variant that does not exist', async () => {
    await expect(
      db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, created_at, updated_at)
         VALUES ('m1', 'nope', 1, 'opening', 'x', 'x')`
      )
    ).rejects.toThrow();
  });
});

describe('IT-ONB onboarding and account', () => {
  it('IT-ONB-01 creates the shop once and updates the same row afterwards', async () => {
    const first = await saveShopDetails(db, { name: ' Shop ', profileId: 'general', town: ' Ndola ', language: 'en', usesBarcodes: false });
    const second = await saveShopDetails(db, { name: 'Shop 2', profileId: 'fashion', town: 'Kitwe', language: 'ny', usesBarcodes: true });
    expect(second).toBe(first);
    expect(await count(db, 'shop')).toBe(1);
    expect(await getShop(db)).toMatchObject({ name: 'Shop 2', type: 'clothes', profileId: 'fashion', town: 'Kitwe', language: 'ny', usesBarcodes: true, onboardingCompleted: false });
    expect(await count(db, 'sync_queue', "entity = 'shop' AND operation = 'create'")).toBe(1);
    expect(await count(db, 'sync_queue', "entity = 'shop' AND operation = 'update'")).toBe(1);
  });

  it('IT-ONB-01b stores the profile and writes its legacy type for sync and USSD', async () => {
    await saveShopDetails(db, { name: 'Glow', profileId: 'health_beauty', town: 'Lusaka', language: 'en', usesBarcodes: true });
    expect(await getShop(db)).toMatchObject({ type: 'other', profileId: 'health_beauty' });
    const create = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'shop' AND operation = 'create'"
    );
    expect(JSON.parse(create?.payload ?? '{}')).toMatchObject({ type: 'other', profileId: 'health_beauty' });

    // A later edit (Settings) changes the profile and keeps the legacy mirror in step.
    await saveShopDetails(db, { name: 'Glow', profileId: 'bar', town: 'Lusaka', language: 'en', usesBarcodes: true });
    expect(await getShop(db)).toMatchObject({ type: 'other', profileId: 'bar' });
    const update = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'shop' AND operation = 'update'"
    );
    expect(JSON.parse(update?.payload ?? '{}')).toMatchObject({ type: 'other', profileId: 'bar' });
  });

  it('IT-ONB-01c falls back from the legacy type when a row has no usable profile', async () => {
    await saveShopDetails(db, { name: 'Old', profileId: 'fashion', town: 'Lusaka', language: 'en', usesBarcodes: false });
    await db.runAsync('UPDATE shop SET profile_id = NULL');
    expect((await getShop(db))?.profileId).toBe('fashion');
    await db.runAsync("UPDATE shop SET profile_id = 'restaurant', type = 'general'");
    expect((await getShop(db))?.profileId).toBe('general');
  });

  it('IT-ONB-02 trims and requires the shop name and town', async () => {
    await expect(saveShopDetails(db, { name: '  ', profileId: 'general', town: 'Lusaka', language: 'en', usesBarcodes: false })).rejects.toThrow('Shop name');
    await expect(saveShopDetails(db, { name: 'A', profileId: 'general', town: ' ', language: 'en', usesBarcodes: false })).rejects.toThrow('Town');
    expect(await count(db, 'shop')).toBe(0);
  });

  it('IT-ONB-03 needs the shop before money settings', async () => {
    await expect(saveMoneySettings(db, { providers: ['MTN'], turnoverTaxRegistered: false })).rejects.toThrow();
  });

  it('IT-ONB-04 keeps only known providers, once each, and a blank TPIN as none', async () => {
    await shop();
    await saveMoneySettings(db, { providers: ['MTN', 'MTN', 'Bank', 'Zamtel'], turnoverTaxRegistered: true, tpin: '  ' });
    expect(await getShop(db)).toMatchObject({ providers: ['MTN', 'Zamtel'], turnoverTaxRegistered: true, tpin: undefined });
  });

  it('IT-ONB-05 rejects a TPIN that is not 10 digits', async () => {
    await shop();
    await expect(saveMoneySettings(db, { providers: [], turnoverTaxRegistered: true, tpin: '12345' })).rejects.toThrow('TPIN');
  });

  it('IT-ONB-06 creates one tax period per month however often it is asked', async () => {
    await ensureTaxPeriod(db, rules, DAY);
    await ensureTaxPeriod(db, rules, '2026-11-30');
    expect(await count(db, 'tax_period')).toBe(1);
    await ensureTaxPeriod(db, rules, '2026-12-01');
    expect(await count(db, 'tax_period')).toBe(2);
  });

  it('IT-ONB-06b names the period tax_<shopId>_<YYYY-MM>, the id the backend and USSD use', async () => {
    await shop();
    const shopRow = await db.getFirstAsync<{ id: string }>('SELECT id FROM shop');
    await ensureTaxPeriod(db, rules, DAY);
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM tax_period');
    expect(row?.id).toBe(`tax_${shopRow?.id}_${DAY.slice(0, 7)}`);
  });

  it('IT-ONB-07 tracks onboarding progress through to completion', async () => {
    expect(await getOnboardingState(db)).toEqual({ hasShop: false, onboardingComplete: false, hasProducts: false });
    await expect(completeOnboarding(db)).rejects.toThrow();
    await shop();
    await product();
    await completeOnboarding(db);
    expect(await getOnboardingState(db)).toEqual({ hasShop: true, onboardingComplete: true, hasProducts: true });
  });

  it('IT-ONB-07b syncs the finished-setup flag so a restored shop does not repeat setup', async () => {
    await shop();
    await product();
    const before = await count(db, 'sync_queue', "entity = 'shop' AND operation = 'update'");

    await completeOnboarding(db);

    expect(await count(db, 'sync_queue', "entity = 'shop' AND operation = 'update'")).toBe(before + 1);
    const queued = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'shop' AND operation = 'update' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    );
    expect(JSON.parse(queued?.payload ?? '{}')).toMatchObject({ onboardingCompleted: true });
  });

  it('IT-ONB-08 allows one owner per phone and does not queue it for sync', async () => {
    await createOwner(db, { id: 'owner_1', name: ' Elton ', phone: '0971234567', pinHash: 'h' });
    expect(await getOwner(db)).toEqual({ id: 'owner_1', name: 'Elton', phone: '0971234567', pinHash: 'h' });
    await expect(createOwner(db, { id: 'owner_2', name: 'B', phone: '0961234567', pinHash: 'h' })).rejects.toThrow();
    expect(await count(db, 'sync_queue', "entity = 'owner'")).toBe(0);
  });

  it('IT-ONB-09 replaces the local PIN hash after an online reset', async () => {
    await createOwner(db, { id: 'owner_1', name: 'Elton', phone: '0971234567', pinHash: 'old' });
    await updateOwnerPinHash(db, 'owner_1', 'new');
    expect((await getOwner(db))?.pinHash).toBe('new');
    await expect(updateOwnerPinHash(db, 'missing', 'new')).rejects.toThrow();
  });

  it('IT-ONB-10 caches the owner email with the local account', async () => {
    await createOwner(db, {
      id: 'owner_1',
      name: 'Elton',
      phone: '0971234567',
      email: 'Elton@Example.com',
      pinHash: 'h',
    });

    expect(await getOwner(db)).toMatchObject({
      id: 'owner_1',
      email: 'elton@example.com',
      pinHash: 'h',
    });
  });

  it('IT-ONB-11 replaces a cached identity after an email login on another phone', async () => {
    await createOwner(db, {
      id: 'owner_1',
      name: 'Elton',
      phone: '0971234567',
      email: 'old@example.com',
      pinHash: 'old',
    });

    const owner = await upsertOwnerFromServer(db, {
      id: 'owner_1',
      name: 'Elton C.',
      phone: '0971234567',
      email: 'new@example.com',
      pinHash: 'new',
    });

    expect(owner).toMatchObject({
      id: 'owner_1',
      name: 'Elton C.',
      email: 'new@example.com',
      pinHash: 'new',
    });
    expect(await count(db, 'owner')).toBe(1);
    expect((await getOwner(db))?.email).toBe('new@example.com');
  });

  it('IT-ONB-12 refuses to replace a different owner already on the phone', async () => {
    await createOwner(db, {
      id: 'owner_1',
      name: 'Owner A',
      phone: '0971234567',
      email: 'a@example.com',
      pinHash: 'a',
    });

    await expect(
      upsertOwnerFromServer(db, {
        id: 'owner_2',
        name: 'Owner B',
        phone: '0965551122',
        email: 'b@example.com',
        pinHash: 'b',
      })
    ).rejects.toThrow('belongs to another shop');

    expect(await getOwner(db)).toMatchObject({ id: 'owner_1', email: 'a@example.com' });
  });
});

describe('IT-STAFF staff identity', () => {
  const owner = { id: 'owner_1', name: 'Elton', phone: '0971234567', pinHash: 'owner-hash' };
  const staff = { id: 'staff_1', name: 'Given', phone: '0965551122', pinHash: 'staff-hash' };

  beforeEach(async () => {
    await createOwner(db, owner);
  });

  it('IT-STAFF-01 caches a staff member without writing to the outbox', async () => {
    const created = await createStaff(db, staff);

    expect(created).toEqual({ ...staff, role: 'staff' });
    expect(await listStaff(db)).toEqual([{ ...staff, role: 'staff' }]);
    expect(await count(db, 'staff')).toBe(1);
    expect(await count(db, 'sync_queue')).toBe(0);
  });

  it('IT-STAFF-02 rejects a phone already used on this phone', async () => {
    await createStaff(db, staff);

    await expect(createStaff(db, { ...staff, id: 'staff_2', phone: '0971234567' })).rejects.toThrow(
      'owner'
    );
    await expect(createStaff(db, { ...staff, id: 'staff_3' })).rejects.toThrow('staff account');
    await expect(createStaff(db, { ...staff, id: 'staff_4', phone: '0960000000', name: '  ' })).rejects.toThrow(
      'name'
    );
  });

  it('IT-STAFF-03 lists everyone who can unlock the phone, owner first', async () => {
    await createStaff(db, staff);

    const identities = await listIdentities(db);

    expect(identities.map((identity) => [identity.role, identity.name])).toEqual([
      ['owner', 'Elton'],
      ['staff', 'Given'],
    ]);
    expect(identities[1].firstSignedInAt).toBeUndefined();
  });

  it('IT-STAFF-04 records the online first check once and can re-cache after a server sign-in', async () => {
    await createStaff(db, staff);
    await markStaffFirstSignIn(db, 'staff_1', '2026-11-17T08:00:00.000Z');
    await markStaffFirstSignIn(db, 'staff_1', '2026-11-17T09:00:00.000Z');

    expect((await listStaff(db))[0].firstSignedInAt).toBe('2026-11-17T08:00:00.000Z');

    const upserted = await upsertStaffFromServer(db, {
      ...staff,
      name: 'Given P.',
      pinHash: 'new-staff-hash',
    });

    expect(upserted.name).toBe('Given P.');
    expect(upserted.pinHash).toBe('new-staff-hash');
    expect(await listStaff(db)).toHaveLength(1);
    expect((await listStaff(db))[0].firstSignedInAt).toBe('2026-11-17T08:00:00.000Z');
  });

  it('IT-STAFF-04b stores a new hash after an owner resets a staff PIN', async () => {
    await createStaff(db, staff);

    await updateStaffPinHash(db, 'staff_1', 'reset-staff-hash');

    expect((await listStaff(db))[0].pinHash).toBe('reset-staff-hash');
    await expect(updateStaffPinHash(db, 'staff_missing', 'x')).rejects.toThrow('not found');
  });

  it('IT-STAFF-05 names the owner or staff member who recorded each sale', async () => {
    await createStaff(db, staff);
    await shop();
    const { variantId } = await product(5);

    const ownerSale = await recordSale(db, {
      ...cashSale(variantId, 1, at(DAY, '09:00')),
      recordedBy: owner.id,
    });
    const staffSale = await recordSale(db, {
      ...cashSale(variantId, 1, at(DAY, '10:00')),
      recordedBy: staff.id,
    });

    expect((await getSaleDetail(db, ownerSale.saleId))?.recordedByName).toBe('Elton');
    expect((await getSaleDetail(db, staffSale.saleId))?.recordedByName).toBe('Given');
    expect((await listSales(db)).map((sale) => sale.recordedByName).sort()).toEqual(['Elton', 'Given']);
    // The sales list says how each sale was paid, and stock history says who sold.
    expect((await listSales(db)).map((sale) => sale.paymentMethod)).toEqual(['cash', 'cash']);
    const sold = (await listMovements(db, variantId)).filter((m) => m.reason === 'sale');
    expect(sold.map((m) => m.byName).sort()).toEqual(['Elton', 'Given']);
  });
});

describe('IT-PROD products and stock', () => {
  it('IT-PROD-00 stores the profile axis values in the legacy size and colour slots', async () => {
    const { variantId } = await product(2, { name: 'Castle Lager', barcode: '6001234500018', size: ' Crate ', colour: '330 ml' });
    const row = await db.getFirstAsync<{ size: string; colour: string }>(
      'SELECT size, colour FROM product_variant WHERE id = ?',
      variantId
    );
    expect(row).toEqual({ size: 'Crate', colour: '330 ml' });
    const queued = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'product_variant' AND entity_id = ?",
      variantId
    );
    expect(JSON.parse(queued?.payload ?? '{}')).toMatchObject({ size: 'Crate', colour: '330 ml' });
    expect((await findVariantByBarcode(db, '6001234500018'))?.variantLabel).toBe('Crate · 330 ml');
  });

  it('IT-PROD-01 records opening stock as a movement and queues the product, variant and movement', async () => {
    const { productId, variantId } = await product(12);
    expect(await stockOf(db, variantId)).toBe(12);
    expect(await count(db, 'stock_movement', "reason = 'opening'")).toBe(1);
    expect(await count(db, 'sync_queue', 'entity_id IN (?, ?)', productId, variantId)).toBe(2);
    // The opening stock is queued as well, so a restored shop keeps its quantities.
    const openingId = (await db.getFirstAsync<{ id: string }>("SELECT id FROM stock_movement WHERE reason = 'opening'"))?.id;
    expect(await count(db, 'sync_queue', "entity = 'stock_movement' AND entity_id = ?", openingId)).toBe(1);
  });

  it('IT-PROD-02 writes no movement for zero opening stock', async () => {
    const { variantId } = await product(0);
    expect(await count(db, 'stock_movement')).toBe(0);
    expect(await stockOf(db, variantId)).toBe(0);
  });

  it('IT-PROD-03 validates name, prices and opening quantity before writing', async () => {
    await expect(product(1, { name: ' ' })).rejects.toThrow();
    await expect(product(1, { sellPrice: -1 })).rejects.toThrow();
    await expect(product(1.5)).rejects.toThrow();
    await expect(product(-1)).rejects.toThrow();
    expect(await count(db, 'product')).toBe(0);
  });

  it('IT-PROD-04 gives an in-store barcode only to shops that use barcodes', async () => {
    await shop(false);
    expect((await product()).barcode).toBeUndefined();
    await shop(true);
    const { barcode } = await product(1, { name: 'Belt' });
    expect(barcode && isInStoreBarcode(barcode)).toBe(true);
  });

  it('IT-PROD-05 refuses a barcode that another product already has', async () => {
    await product(1, { barcode: '6001234500018' });
    await expect(product(1, { name: 'Other', barcode: '600 1234 500018' })).rejects.toThrow('already belongs');
  });

  it('IT-PROD-06 finds a product by its EAN-13 or the scanner\'s 12-digit UPC-A form', async () => {
    const { variantId } = await product(1, { barcode: '0012345678905' });
    expect((await findVariantByBarcode(db, '012345678905'))?.variantId).toBe(variantId);
    expect((await findVariantByBarcode(db, '0012345678905'))?.variantLabel).toBe('Single');
    expect(await findVariantByBarcode(db, '9999999999994')).toBeNull();
  });

  it('IT-PROD-07 adds a barcode later and refuses one already in use', async () => {
    await shop(true);
    const taken = await product(1, { barcode: '6001234500018' });
    const { variantId } = await product(1, { name: 'Cap', barcode: '' });
    // A shop with barcodes on gets one automatically; replace it by hand.
    await expect(setVariantBarcode(db, variantId, '6001234500018')).rejects.toThrow();
    expect(await setVariantBarcode(db, variantId, '4006381333931')).toBe('4006381333931');
    expect(taken.variantId).not.toBe(variantId);
  });

  it('IT-PROD-08 refuses to invent a barcode for a shop without barcodes', async () => {
    await shop(false);
    const { variantId } = await product();
    await expect(setVariantBarcode(db, variantId)).rejects.toThrow('does not use barcodes');
  });

  it('IT-PROD-09 restocks and changes the buy price for future sales only', async () => {
    const { variantId } = await product(2);
    await recordSale(db, cashSale(variantId));
    const restocked = await restockVariant(db, { variantId, quantity: 5, buyPrice: 5500, note: 'Supplier A' });
    expect(restocked).toEqual({ variantId, quantityAdded: 5, buyPrice: 5500, quantityOnHand: 6 });
    const line = await db.getFirstAsync<{ buy_price: number }>('SELECT buy_price FROM sale_line');
    expect(line?.buy_price).toBe(5000);
    const movements = await listMovements(db, variantId);
    expect(movements.find((m) => m.reason === 'restock')).toMatchObject({ quantityChange: 5, note: 'Supplier A' });
  });

  it('IT-PROD-10 rejects a bad restock without writing anything', async () => {
    const { variantId } = await product(2);
    await expect(restockVariant(db, { variantId, quantity: 0 })).rejects.toThrow();
    await expect(restockVariant(db, { variantId: 'missing', quantity: 1 })).rejects.toThrow('not found');
    expect(await count(db, 'stock_movement', "reason = 'restock'")).toBe(0);
  });

  it('IT-PROD-11 lists stock state and low-stock alerts at the inclusive level', async () => {
    await product(10, { name: 'Plenty', lowStockLevel: 3 });
    await product(3, { name: 'Low', lowStockLevel: 3 });
    await product(0, { name: 'Out', lowStockLevel: 3 });
    const states = Object.fromEntries((await listProductsWithStock(db)).map((p) => [p.name, p.variants[0].state]));
    expect(states).toEqual({ Plenty: 'ok', Low: 'low', Out: 'out' });
    expect((await lowStockVariants(db)).map((row) => row.label)).toEqual(['Out', 'Low']);
  });

  it('IT-PROD-12 survives a corrupt discount on one product', async () => {
    const { productId } = await product();
    await db.runAsync("UPDATE product SET discount_json = '{oops' WHERE id = ?", productId);
    const [listed] = await listProductsWithStock(db);
    expect(listed.discount).toBeUndefined();
  });
});

describe('IT-PRODF trade-specific product fields', () => {
  it('IT-PRODF-01 stores unit, sale warning, expiry and batch, and reads them back', async () => {
    const { productId, variantId } = await product(5, {
      name: 'Amoxil',
      size: '500 mg',
      colour: 'Strip of 10',
      unit: 'strip',
      saleWarning: ' Rx only ',
      expiryDate: '2027-06-30',
      batchNo: 'B12',
    });
    const listed = (await listProductsWithStock(db)).find((item) => item.id === productId);
    expect(listed).toMatchObject({ unit: 'strip', saleWarning: 'Rx only' });
    expect(listed?.variants[0]).toMatchObject({ id: variantId, expiryDate: '2027-06-30', batchNo: 'B12' });

    const queuedProduct = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'product' AND entity_id = ?",
      productId
    );
    expect(JSON.parse(queuedProduct?.payload ?? '{}')).toMatchObject({ unit: 'strip', saleWarning: 'Rx only' });
    const queuedVariant = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'product_variant' AND entity_id = ?",
      variantId
    );
    expect(JSON.parse(queuedVariant?.payload ?? '{}')).toMatchObject({ expiryDate: '2027-06-30', batchNo: 'B12' });
  });

  it('IT-PRODF-02 gives older products a piece unit and no expiry', async () => {
    const { productId } = await product(2);
    await db.runAsync('UPDATE product SET unit = NULL WHERE id = ?', productId);
    const listed = (await listProductsWithStock(db)).find((item) => item.id === productId);
    expect(listed).toMatchObject({ unit: 'piece' });
    expect(listed?.saleWarning).toBeUndefined();
    expect(listed?.variants[0].expiryDate).toBeUndefined();
  });

  it('IT-PRODF-04 refuses an impossible expiry date and saves nothing', async () => {
    await expect(product(1, { name: 'Bad date', expiryDate: '2027-02-30' })).rejects.toThrow('Expiry date');
    expect(await count(db, 'product')).toBe(0);
  });

  it('IT-PRODF-05 restock sets the new delivery expiry and batch, and queues only what changed', async () => {
    const { variantId } = await product(3, { name: 'Panadol', expiryDate: '2026-12-01', batchNo: 'OLD' });
    await restockVariant(db, { variantId, quantity: 10, expiryDate: '2027-12-01', batchNo: 'NEW' });
    const row = await db.getFirstAsync<{ expiry_date: string; batch_no: string; buy_price: number }>(
      'SELECT expiry_date, batch_no, buy_price FROM product_variant WHERE id = ?',
      variantId
    );
    expect(row).toEqual({ expiry_date: '2027-12-01', batch_no: 'NEW', buy_price: 5000 });
    const update = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'product_variant' AND operation = 'update' AND entity_id = ?",
      variantId
    );
    const payload = JSON.parse(update?.payload ?? '{}');
    expect(payload).toMatchObject({ id: variantId, expiryDate: '2027-12-01', batchNo: 'NEW' });
    expect(payload).not.toHaveProperty('buyPrice');

    await expect(restockVariant(db, { variantId, quantity: 1, expiryDate: 'next year' })).rejects.toThrow('Expiry date');
  });

  it('IT-PRODF-06 upgrades a v10 phone without touching its products', async () => {
    const old = openBlankDb();
    try {
      await old.execAsync('PRAGMA foreign_keys = ON;');
      for (let version = 0; version < 10; version += 1) await old.execAsync(migrations[version]);
      await old.execAsync('PRAGMA user_version = 10;');
      await old.runAsync(
        `INSERT INTO product (id, name, default_buy_price, default_sell_price, created_at, updated_at)
         VALUES ('p1', 'Old shirt', 100, 200, 'x', 'x')`
      );
      await old.runAsync(
        `INSERT INTO product_variant (id, product_id, size, buy_price, sell_price, created_at, updated_at)
         VALUES ('v1', 'p1', 'M', 100, 200, 'x', 'x')`
      );

      await initializeDatabase(old);

      expect(
        await old.getFirstAsync('SELECT unit, sale_warning FROM product WHERE id = ?', 'p1')
      ).toEqual({ unit: null, sale_warning: null });
      expect(
        await old.getFirstAsync('SELECT size, expiry_date, batch_no FROM product_variant WHERE id = ?', 'v1')
      ).toEqual({ size: 'M', expiry_date: null, batch_no: null });
    } finally {
      old.close();
    }
  });
});

describe('IT-VAR products with several variants', () => {
  const pack = (value: string, size = '') => [
    { key: 'pack', value },
    { key: 'size', value: size },
  ];
  const lager = (variants: Parameters<typeof createProductWithVariants>[1]['variants']) =>
    createProductWithVariants(db, { name: 'Castle Lager', category: 'Beer', unit: 'bottle', saleWarning: '18+', variants });

  it('IT-VAR-01 saves each variant with its own price, stock, barcode and attributes', async () => {
    await shop();
    const { productId, variantIds } = await lager([
      { attributes: pack('Shot'), buyPrice: 300, sellPrice: 500, openingQuantity: 0 },
      { attributes: pack('Bottle', '330 ml'), barcode: '6001234500018', buyPrice: 1200, sellPrice: 1800, openingQuantity: 24 },
      { attributes: pack('Crate'), buyPrice: 26000, sellPrice: 36000, openingQuantity: 3, lowStockLevel: 1 },
    ]);
    expect(variantIds).toHaveLength(3);

    const listed = (await listProductsWithStock(db)).find((item) => item.id === productId);
    // Variants come back in the order they were entered; the first sets the default prices.
    expect(listed).toMatchObject({ name: 'Castle Lager', unit: 'bottle', saleWarning: '18+', defaultSellPrice: 500, stock: 27 });
    expect(listed?.variants.map((variant) => [variant.attributes, variant.sellPrice, variant.quantity])).toEqual([
      [[{ key: 'pack', value: 'Shot' }], 500, 0],
      [[{ key: 'pack', value: 'Bottle' }, { key: 'size', value: '330 ml' }], 1800, 24],
      [[{ key: 'pack', value: 'Crate' }], 36000, 3],
    ]);

    // Legacy mirrors follow axis position; attributes_json keeps the keys.
    const rows = await db.getAllAsync<{ size: string | null; colour: string | null; attributes_json: string }>(
      'SELECT size, colour, attributes_json FROM product_variant WHERE product_id = ? ORDER BY created_at, size',
      productId
    );
    expect(rows.map((row) => [row.size, row.colour])).toEqual(
      expect.arrayContaining([['Bottle', '330 ml'], ['Crate', null], ['Shot', null]])
    );
    expect(await count(db, 'stock_movement', "reason = 'opening'")).toBe(2);
    expect(await count(db, 'sync_queue', "entity = 'product_variant'")).toBe(3);
    const queued = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM sync_queue WHERE entity = 'product_variant' AND entity_id = ?",
      variantIds[2]
    );
    expect(JSON.parse(queued?.payload ?? '{}')).toMatchObject({
      productId,
      size: 'Crate',
      colour: null,
      attributes: [{ key: 'pack', value: 'Crate' }],
      lowStockLevel: 1,
    });
  });

  it('IT-VAR-02 selling one variant takes stock from that variant only', async () => {
    await shop();
    const { variantIds } = await lager([
      { attributes: pack('Bottle'), buyPrice: 5000, sellPrice: 8000, openingQuantity: 10 },
      { attributes: pack('Crate'), buyPrice: 5000, sellPrice: 8000, openingQuantity: 4 },
      { attributes: pack('Can'), buyPrice: 5000, sellPrice: 8000, openingQuantity: 6 },
    ]);
    await recordSale(db, cashSale(variantIds[1], 2));
    expect([await stockOf(db, variantIds[0]), await stockOf(db, variantIds[1]), await stockOf(db, variantIds[2])]).toEqual([10, 2, 6]);
  });

  it('IT-VAR-03 refuses the same variant twice, ignoring case, and saves nothing', async () => {
    await shop();
    await expect(
      lager([
        { attributes: pack('Crate'), buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
        { attributes: pack(' crate '), buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
      ])
    ).rejects.toThrow('Two variants are the same: crate');
    await expect(
      createProductWithVariants(db, {
        name: 'Plain',
        variants: [
          { attributes: [], buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
          { attributes: [], buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
        ],
      })
    ).rejects.toThrow('Each variant needs its own size or type');
    await expect(createProductWithVariants(db, { name: 'Empty', variants: [] })).rejects.toThrow('at least one variant');
    expect(await count(db, 'product')).toBe(0);
    expect(await count(db, 'sync_queue', "entity <> 'shop'")).toBe(0);
  });

  it('IT-VAR-04 refuses a barcode used twice in the form or already in the shop', async () => {
    await shop();
    await expect(
      lager([
        { attributes: pack('Bottle'), barcode: '012345678905', buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
        { attributes: pack('Can'), barcode: '0012345678905', buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
      ])
    ).rejects.toThrow('Two variants have the same barcode');
    await product(1, { barcode: '6001234500018' });
    await expect(
      lager([
        { attributes: pack('Bottle'), buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
        { attributes: pack('Can'), barcode: '6001234500018', buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
      ])
    ).rejects.toThrow('already belongs to another product');
    expect(await count(db, 'product')).toBe(1);
  });

  it('IT-VAR-05 gives each variant its own barcode when the shop uses barcodes', async () => {
    await shop(true);
    const { barcodes } = await lager([
      { attributes: pack('Bottle'), buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
      { attributes: pack('Crate'), buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
      { attributes: pack('Can'), barcode: '6001234500018', buyPrice: 1, sellPrice: 2, openingQuantity: 1 },
    ]);
    expect(barcodes[2]).toBe('6001234500018');
    expect(isInStoreBarcode(barcodes[0]!)).toBe(true);
    expect(isInStoreBarcode(barcodes[1]!)).toBe(true);
    expect(new Set(barcodes).size).toBe(3);
  });

  it('IT-VAR-06 labels low stock, scans and sale lines from the attributes', async () => {
    await shop();
    const { variantIds } = await lager([
      { attributes: pack('Crate', '330 ml'), barcode: '6001234500018', buyPrice: 5000, sellPrice: 8000, openingQuantity: 1, lowStockLevel: 2 },
    ]);
    expect((await lowStockVariants(db)).map((row) => row.label)).toEqual(['Castle Lager · Crate · 330 ml']);
    expect((await findVariantByBarcode(db, '6001234500018'))?.variantLabel).toBe('Crate · 330 ml');
    const { saleId } = await recordSale(db, cashSale(variantIds[0]));
    expect((await getSaleDetail(db, saleId))?.lines[0].label).toBe('Castle Lager · Crate · 330 ml');
  });

  it('IT-VAR-07 still reads older variants that only have size and colour', async () => {
    await shop();
    const { productId, variantId } = await product(1, { size: 'M', colour: 'Blue' });
    await db.runAsync('UPDATE product_variant SET attributes_json = NULL WHERE id = ?', variantId);
    const listed = (await listProductsWithStock(db)).find((item) => item.id === productId);
    expect(listed?.variants[0].attributes).toEqual([
      { key: 'size', value: 'M' },
      { key: 'colour', value: 'Blue' },
    ]);
    expect((await lowStockVariants(db)).map((row) => row.label)).toEqual(['School shirt · M · Blue']);
  });

  it('IT-VAR-08 keeps an empty first axis out of the size column', async () => {
    await shop();
    const { variantId } = await product(1, { colour: 'Red' });
    expect(
      await db.getFirstAsync('SELECT size, colour, attributes_json FROM product_variant WHERE id = ?', variantId)
    ).toEqual({ size: null, colour: 'Red', attributes_json: '[{"key":"colour","value":"Red"}]' });
  });

  it('IT-VAR-09 upgrades a v11 phone without touching its variants', async () => {
    const old = openBlankDb();
    try {
      await old.execAsync('PRAGMA foreign_keys = ON;');
      for (let version = 0; version < 11; version += 1) await old.execAsync(migrations[version]);
      await old.execAsync('PRAGMA user_version = 11;');
      await old.runAsync(
        `INSERT INTO product (id, name, default_buy_price, default_sell_price, created_at, updated_at)
         VALUES ('p1', 'Old shirt', 100, 200, 'x', 'x')`
      );
      await old.runAsync(
        `INSERT INTO product_variant (id, product_id, size, colour, buy_price, sell_price, created_at, updated_at)
         VALUES ('v1', 'p1', 'M', 'Blue', 100, 200, 'x', 'x')`
      );
      await initializeDatabase(old);
      expect(
        await old.getFirstAsync('SELECT size, colour, attributes_json FROM product_variant WHERE id = ?', 'v1')
      ).toEqual({ size: 'M', colour: 'Blue', attributes_json: null });
    } finally {
      old.close();
    }
  });
});

describe('IT-EXP expiring stock', () => {
  const today = '2026-11-27';

  it('IT-EXP-01 lists stock on hand that has expired or expires within 30 days, soonest first', async () => {
    await shop();
    const { variantIds } = await createProductWithVariants(db, {
      name: 'Panadol',
      variants: [
        { attributes: [{ key: 'pack', value: 'Strip' }], buyPrice: 1, sellPrice: 2, openingQuantity: 4, expiryDate: '2026-12-20' },
        { attributes: [{ key: 'pack', value: 'Box' }], buyPrice: 1, sellPrice: 2, openingQuantity: 2, expiryDate: '2026-11-01' },
        { attributes: [{ key: 'pack', value: 'Bottle' }], buyPrice: 1, sellPrice: 2, openingQuantity: 5, expiryDate: '2027-06-30' },
        { attributes: [{ key: 'pack', value: 'Sachet' }], buyPrice: 1, sellPrice: 2, openingQuantity: 0, expiryDate: '2026-11-02' },
      ],
    });
    await product(3, { name: 'No expiry' });

    expect(await expiringVariants(db, today)).toEqual([
      { variantId: variantIds[1], productId: expect.any(String), label: 'Panadol · Box', expiryDate: '2026-11-01', quantity: 2 },
      { variantId: variantIds[0], productId: expect.any(String), label: 'Panadol · Strip', expiryDate: '2026-12-20', quantity: 4 },
    ]);

    // Once sold out it drops off the list.
    await recordSale(db, cashSale(variantIds[1], 2));
    expect((await expiringVariants(db, today)).map((row) => row.variantId)).toEqual([variantIds[0]]);
  });
});

describe('IT-SALE recording and voiding sales', () => {
  it('IT-SALE-01 writes sale, line, payment and movement together and queues one sync row', async () => {
    const { variantId } = await product(5);
    const { saleId, total } = await recordSale(db, cashSale(variantId, 2));
    expect(total).toBe(16000);
    expect(await stockOf(db, variantId)).toBe(3);
    expect(await count(db, 'sale_line', 'sale_id = ?', saleId)).toBe(1);
    expect(await count(db, 'payment', 'sale_id = ?', saleId)).toBe(1);
    const queued = await db.getAllAsync<{ payload: string }>("SELECT payload FROM sync_queue WHERE entity = 'sale'");
    expect(queued).toHaveLength(1);
    const payload = JSON.parse(queued[0].payload);
    expect(payload.sale.id).toBe(saleId);
    expect(payload.lines).toHaveLength(1);
    expect(payload.payments).toHaveLength(1);
    expect(payload.stockMovements[0].quantityChange).toBe(-2);
  });

  it('IT-SALE-02 writes nothing when payments do not add up', async () => {
    const { variantId } = await product(5);
    await expect(
      recordSale(db, { ...cashSale(variantId), payments: [{ method: 'cash', amount: 100 }] })
    ).rejects.toThrow('does not match');
    expect(await count(db, 'sale')).toBe(0);
    expect(await stockOf(db, variantId)).toBe(5);
  });

  it('IT-SALE-03 blocks selling past stock and rolls the whole sale back', async () => {
    const { variantId } = await product(1);
    const error = await recordSale(db, cashSale(variantId, 2)).catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientStockError);
    expect(error.shortfalls).toEqual([{ variantId, onHand: 1, requested: 2 }]);
    expect(await count(db, 'sale')).toBe(0);
    expect(await count(db, 'sync_queue', "entity = 'sale'")).toBe(0);
  });

  it('IT-SALE-04 sums the same variant across lines before checking stock', async () => {
    const { variantId } = await product(2);
    const input = cashSale(variantId);
    input.lines = [input.lines[0], input.lines[0], input.lines[0]];
    input.payments = [{ method: 'cash', amount: 24000 }];
    await expect(recordSale(db, input)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('IT-SALE-05 sells past stock with an approved override and notes who approved it', async () => {
    const { variantId } = await product(1);
    await recordSale(db, { ...cashSale(variantId, 3), override: { approvedBy: 'owner_1', shortfalls: [{ variantId, onHand: 1, requested: 3 }] } });
    expect(await stockOf(db, variantId)).toBe(-2);
    const movement = await db.getFirstAsync<{ note: string }>("SELECT note FROM stock_movement WHERE reason = 'sale'");
    expect(movement?.note).toContain('Override by owner_1');
  });

  it('IT-SALE-06 does not stretch an override to a bigger quantity than was approved', async () => {
    const { variantId } = await product(1);
    await expect(
      recordSale(db, { ...cashSale(variantId, 4), override: { approvedBy: 'owner_1', shortfalls: [{ variantId, onHand: 1, requested: 3 }] } })
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('IT-SALE-07 reports a loss-making line without blocking the sale', async () => {
    const { variantId } = await product(1);
    const input = cashSale(variantId);
    input.lines[0].lineDiscount = 4000;
    input.payments = [{ method: 'cash', amount: 4000 }];
    const recorded = await recordSale(db, input);
    expect(recorded.belowCost).toEqual([{ variantId, finalPrice: 4000 }]);
  });

  it('IT-SALE-08 voids once, restores stock, and refuses a second void', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, cashSale(variantId, 2));
    await voidSale(db, saleId, 'Wrong size');
    expect(await stockOf(db, variantId)).toBe(5);
    await expect(voidSale(db, saleId, 'again')).rejects.toThrow('already void');
    expect(await stockOf(db, variantId)).toBe(5);
    expect(await getSaleDetail(db, saleId)).toMatchObject({ status: 'void', voidReason: 'Wrong size' });
    await expect(voidSale(db, 'missing', 'x')).rejects.toThrow('not found');
  });

  it('IT-SALE-09 counts only active sales of the local day in the totals', async () => {
    const { variantId } = await product(20);
    await recordSale(db, cashSale(variantId, 1, at(DAY, '00:30')));
    await recordSale(db, cashSale(variantId, 2, at(DAY, '23:30')));
    await recordSale(db, cashSale(variantId, 1, at('2026-11-16', '23:59')));
    const voided = await recordSale(db, cashSale(variantId, 1, at(DAY, '12:00')));
    await voidSale(db, voided.saleId, 'test');
    expect(await totalsForDay(db, DAY)).toEqual({
      salesTotal: 24000,
      saleCount: 2,
      discounts: 0,
      cost: 15000,
      grossProfit: 9000,
    });
  });

  it('IT-SALE-10 shows a split sale with both payments in its detail', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, {
      ...cashSale(variantId),
      payments: [
        { method: 'cash', amount: 3000 },
        { method: 'mobile_money', amount: 5000, provider: 'Airtel' },
      ],
    });
    const detail = await getSaleDetail(db, saleId);
    expect(detail?.lines[0].label).toBe('School shirt');
    expect(detail?.payments.map((p) => p.method).sort()).toEqual(['cash', 'mobile_money']);
    expect(await getSaleDetail(db, 'missing')).toBeNull();
  });
});

describe('IT-REC reconciliation', () => {
  it('IT-REC-00 a pasted message with a reference pairs with a sale that has none', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at(DAY, '10:00')));
    const txn = await addPaymentMessage(db, {
      provider: 'MTN',
      amount: 8000,
      reference: '8812345678',
      sender: 'JOHN BANDA',
      receivedAt: at(DAY, '10:02'),
      rawMessage: 'You have received ZMW 80.00 from JOHN BANDA. Financial Transaction Id: 8812345678.',
      parsed: true,
    });
    const result = await reconcileDay(db, DAY);
    expect(result.matched).toEqual([expect.objectContaining({ saleId, txnId: txn })]);
    const queued = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sync_queue WHERE entity = 'mobile_money_txn' AND entity_id = ? AND operation = 'create'",
      txn
    );
    expect(queued?.n).toBe(1);
  });

  it('IT-REC-00b refuses the same reference pasted twice', async () => {
    const input = {
      provider: 'Airtel' as const,
      amount: 5000,
      reference: 'PP261117.A1',
      receivedAt: at(DAY, '11:00'),
      rawMessage: 'x',
      parsed: true,
    };
    await addPaymentMessage(db, input);
    await expect(addPaymentMessage(db, { ...input, reference: ' pp261117.a1 ' })).rejects.toBeInstanceOf(
      DuplicateMessageError
    );
  });

  it('IT-REC-01 matches a sale to its message and persists both statuses', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at(DAY, '10:00')));
    const txn = await message(8000, at(DAY, '10:04'));
    const result = await reconcileDay(db, DAY);
    expect(result.matched).toEqual([expect.objectContaining({ saleId, txnId: txn, amount: 8000 })]);
    expect(await saleStatus(saleId)).toBe('matched');
    expect(await txnStatus(txn)).toBe('matched');
  });

  it('IT-REC-02 reports a sale with no message and a message with no sale', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId));
    const orphan = await message(45000, at(DAY, '11:00'), 'ZM123', 'Zamtel');
    const result = await reconcileDay(db, DAY);
    expect(result.salesWithoutPayment.map((s) => s.saleId)).toEqual([saleId]);
    expect(result.paymentsWithoutSale.map((p) => p.txnId)).toEqual([orphan]);
    expect(await saleStatus(saleId)).toBe('sale_no_payment');
  });

  it('IT-REC-03 leaves cash sales out of message matching', async () => {
    const { variantId } = await product(5);
    await recordSale(db, cashSale(variantId));
    await message(8000, at(DAY, '10:01'));
    const result = await reconcileDay(db, DAY);
    expect(result.matched).toEqual([]);
    expect(result.salesWithoutPayment).toEqual([]);
    expect(result.paymentsWithoutSale).toHaveLength(1);
  });

  it('IT-REC-04 sends two fitting sales to review instead of guessing', async () => {
    const { variantId } = await product(5);
    const a = await recordSale(db, mobileSale(variantId, at(DAY, '10:00')));
    const b = await recordSale(db, mobileSale(variantId, at(DAY, '10:10')));
    await message(8000, at(DAY, '10:05'));
    const result = await reconcileDay(db, DAY);
    expect(result.needsReview.map((s) => s.saleId).sort()).toEqual([a.saleId, b.saleId].sort());
    expect(await saleStatus(a.saleId)).toBe('unresolved');
  });

  it('IT-REC-05 keeps a hand confirmation after the matcher runs again', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId));
    await reconcileDay(db, DAY);
    await markSalePaid(db, saleId);
    const result = await reconcileDay(db, DAY);
    expect(await saleStatus(saleId)).toBe('matched');
    expect(result.matched).toEqual([expect.objectContaining({ saleId, txnId: '' })]);
    expect(await count(db, 'payment', 'sale_id = ?', saleId)).toBe(1);
    await expect(markSalePaid(db, saleId)).rejects.toThrow('no mobile money payment waiting');
  });

  it('IT-REC-06 keeps an ignored message out of later runs', async () => {
    const txn = await message(1000, at(DAY, '09:00'));
    await ignorePayment(db, txn);
    const result = await reconcileDay(db, DAY);
    expect(result.paymentsWithoutSale).toEqual([]);
    expect(await txnStatus(txn)).toBe('ignored');
  });

  it('IT-REC-07 matches a payment that arrives just after midnight to the sale before it', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at(DAY, '23:50')));
    const txn = await message(8000, at('2026-11-18', '00:05'));
    await reconcileDay(db, DAY);
    expect(await saleStatus(saleId)).toBe('matched');
    expect(await txnStatus(txn)).toBe('matched');
  });

  it('IT-REC-07b keeps a cross-midnight match when the next day is reconciled', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at(DAY, '23:50')));
    const txn = await message(8000, at('2026-11-18', '00:05'));
    await reconcileDay(db, DAY);
    const nextDay = await reconcileDay(db, '2026-11-18');
    expect(nextDay.paymentsWithoutSale).toEqual([]);
    expect(await txnStatus(txn)).toBe('matched');
    expect(await saleStatus(saleId)).toBe('matched');
  });

  it('IT-REC-07c keeps a match when the sale is after midnight and the message before', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at('2026-11-18', '00:05')));
    const txn = await message(8000, at(DAY, '23:55'));
    await reconcileDay(db, DAY);
    const nextDay = await reconcileDay(db, '2026-11-18');
    expect(nextDay.matched).toEqual([expect.objectContaining({ saleId, txnId: txn })]);
    expect(nextDay.salesWithoutPayment).toEqual([]);
    expect(await saleStatus(saleId)).toBe('matched');
    // Running the first day again does not disturb it either.
    expect((await reconcileDay(db, DAY)).paymentsWithoutSale).toEqual([]);
  });

  it('IT-REC-07d does not let a later run hand a matched message to another sale', async () => {
    const { variantId } = await product(5);
    const first = await recordSale(db, mobileSale(variantId, at(DAY, '10:00')));
    const txn = await message(8000, at(DAY, '10:05'));
    await reconcileDay(db, DAY);
    // A second identical sale recorded later would make the pair ambiguous if
    // the matcher started over; the earlier decision stands instead.
    const second = await recordSale(db, mobileSale(variantId, at(DAY, '10:10')));
    const result = await reconcileDay(db, DAY);
    expect(result.matched).toEqual([expect.objectContaining({ saleId: first.saleId, txnId: txn })]);
    expect(result.salesWithoutPayment.map((s) => s.saleId)).toEqual([second.saleId]);
  });

  it('IT-REC-07e releases the message when its matched sale is voided', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId));
    const txn = await message(8000, at(DAY, '10:05'));
    await reconcileDay(db, DAY);
    await voidSale(db, saleId, 'Customer cancelled');
    const result = await reconcileDay(db, DAY);
    expect(result.paymentsWithoutSale.map((p) => p.txnId)).toEqual([txn]);
    expect(await txnStatus(txn)).toBe('unmatched');
  });

  it('IT-REC-08 queues a status change once, not on every rerun', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId));
    await reconcileDay(db, DAY);
    const after = await count(db, 'sync_queue', "entity = 'sale' AND entity_id = ? AND operation = 'update'", saleId);
    await reconcileDay(db, DAY);
    expect(await count(db, 'sync_queue', "entity = 'sale' AND entity_id = ? AND operation = 'update'", saleId)).toBe(after);
  });

  it('IT-REC-09 computes expected cash and keeps one cash count per day', async () => {
    const { variantId } = await product(5);
    await recordSale(db, cashSale(variantId, 2));
    await db.runAsync(
      "INSERT INTO reconciliation (id, day, opening_float, created_at, updated_at) VALUES ('r1', ?, 5000, 'x', 'x')",
      DAY
    );
    expect(await saveCashCount(db, DAY, 20000, 'short')).toEqual({ expected: 21000, variance: -1000 });
    await expect(saveCashCount(db, DAY, 21000)).rejects.toThrow('already been saved');
    expect(await saveCashCount(db, DAY, 21000, undefined, true)).toEqual({ expected: 21000, variance: 0 });
    expect(await count(db, 'reconciliation')).toBe(1);
    expect((await reconcileDay(db, DAY)).cash).toMatchObject({ openingFloat: 5000, expected: 21000, countedCash: 21000, variance: 0 });
  });

  it('IT-REC-10 demo messages match the newest open sale and add one orphan only', async () => {
    const { variantId } = await product(5);
    const { saleId } = await recordSale(db, mobileSale(variantId, at(DAY, '10:00')));
    // The demo stamps messages with "now", so run it on today's real date.
    await db.runAsync('UPDATE sale SET created_at = ?', new Date().toISOString());
    expect(await injectDemoMessages(db)).toEqual({ matched: 1, orphan: 1 });
    expect(await injectDemoMessages(db)).toEqual({ matched: 0, orphan: 0 });
    await reconcileDay(db);
    expect(await saleStatus(saleId)).toBe('matched');
  });
});

describe('IT-TAX tax and TaxPot', () => {
  beforeEach(async () => {
    await ensureTaxPeriod(db, rules, DAY);
  });

  async function periodId() {
    return (await taxSnapshot(db, DAY)).period!.id;
  }

  it('IT-TAX-01 sums only this period\'s active sales as turnover', async () => {
    const { variantId } = await product(20);
    await recordSale(db, cashSale(variantId, 1, at('2026-11-01', '00:10')));
    await recordSale(db, cashSale(variantId, 1, at('2026-11-30', '23:50')));
    await recordSale(db, cashSale(variantId, 1, at('2026-10-31', '23:50')));
    const voided = await recordSale(db, cashSale(variantId, 1, at(DAY, '10:00')));
    await voidSale(db, voided.saleId, 'x');
    expect((await taxSnapshot(db, DAY)).turnover).toBe(16000);
  });

  it('IT-TAX-02 counts only unreconciled mobile money sales as unresolved', async () => {
    const { variantId } = await product(20);
    await recordSale(db, cashSale(variantId));
    await recordSale(db, mobileSale(variantId));
    expect((await taxSnapshot(db, DAY)).unresolvedSales).toBe(1);
  });

  it('IT-TAX-03 accepts only whole positive top-ups', async () => {
    const id = await periodId();
    await expect(topUpTaxPot(db, id, 0)).rejects.toThrow();
    await expect(topUpTaxPot(db, id, 10.5)).rejects.toThrow();
    await topUpTaxPot(db, id, 5000);
    await topUpTaxPot(db, id, 2500);
    expect((await taxSnapshot(db, DAY)).potBalance).toBe(7500);
  });

  it('IT-TAX-04 pays the whole pot once, keeps history and marks the period paid', async () => {
    const id = await periodId();
    await topUpTaxPot(db, id, 7500);
    expect(await payTaxPot(db, id)).toMatchObject({ amount: 7500 });
    const view = await getTaxPotView(db, DAY);
    expect(view.potBalance).toBe(0);
    expect(view.entries.map((e) => e.kind).sort()).toEqual(['paid', 'top_up']);
    expect((await db.getFirstAsync<{ paid: number }>('SELECT paid FROM tax_period WHERE id = ?', id))?.paid).toBe(1);
    await expect(payTaxPot(db, id)).rejects.toThrow('nothing set aside');
  });

  it('IT-TAX-05 shows an empty view before any tax period exists', async () => {
    const fresh = await openTestDb();
    expect(await getTaxPotView(fresh, DAY)).toEqual({ turnover: 0, yearToDate: 0, potBalance: 0, period: null, unresolvedSales: 0, entries: [] });
    fresh.close();
  });
});
