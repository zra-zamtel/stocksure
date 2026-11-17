import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from './migrate';
import { migrations } from './schema';
import {
  completeOnboarding,
  createOwner,
  createProduct,
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
  await saveShopDetails(db, { name: 'Chiwala Fashions', type: 'clothes', town: 'Lusaka', language: 'en', usesBarcodes });
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
    const first = await saveShopDetails(db, { name: ' Shop ', type: 'general', town: ' Ndola ', language: 'en', usesBarcodes: false });
    const second = await saveShopDetails(db, { name: 'Shop 2', type: 'shoes', town: 'Kitwe', language: 'ny', usesBarcodes: true });
    expect(second).toBe(first);
    expect(await count(db, 'shop')).toBe(1);
    expect(await getShop(db)).toMatchObject({ name: 'Shop 2', town: 'Kitwe', language: 'ny', usesBarcodes: true, onboardingCompleted: false });
    expect(await count(db, 'sync_queue', "entity = 'shop' AND operation = 'create'")).toBe(1);
    expect(await count(db, 'sync_queue', "entity = 'shop' AND operation = 'update'")).toBe(1);
  });

  it('IT-ONB-02 trims and requires the shop name and town', async () => {
    await expect(saveShopDetails(db, { name: '  ', type: 'other', town: 'Lusaka', language: 'en', usesBarcodes: false })).rejects.toThrow('Shop name');
    await expect(saveShopDetails(db, { name: 'A', type: 'other', town: ' ', language: 'en', usesBarcodes: false })).rejects.toThrow('Town');
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

  it('IT-ONB-07 tracks onboarding progress through to completion', async () => {
    expect(await getOnboardingState(db)).toEqual({ hasShop: false, onboardingComplete: false, hasProducts: false });
    await expect(completeOnboarding(db)).rejects.toThrow();
    await shop();
    await product();
    await completeOnboarding(db);
    expect(await getOnboardingState(db)).toEqual({ hasShop: true, onboardingComplete: true, hasProducts: true });
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
    ).rejects.toThrow('different owner');

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
  });
});

describe('IT-PROD products and stock', () => {
  it('IT-PROD-01 records opening stock as a movement and queues both rows', async () => {
    const { productId, variantId } = await product(12);
    expect(await stockOf(db, variantId)).toBe(12);
    expect(await count(db, 'stock_movement', "reason = 'opening'")).toBe(1);
    expect(await count(db, 'sync_queue', 'entity_id IN (?, ?)', productId, variantId)).toBe(2);
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
    expect(await getTaxPotView(fresh, DAY)).toEqual({ turnover: 0, potBalance: 0, period: null, unresolvedSales: 0, entries: [] });
    fresh.close();
  });
});
