import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from '@/db/migrate';
import { migrations } from '@/db/schema';
import { seedDemoShop } from '@/db/seed';
import {
  completeOnboarding,
  createOwner,
  createProduct,
  ensureTaxPeriod,
  findVariantByBarcode,
  getOnboardingState,
  getSaleDetail,
  getShop,
  getTaxPotView,
  ignorePayment,
  listProductsWithStock,
  listSales,
  lowStockVariants,
  markSalePaid,
  payTaxPot,
  reconcileDay,
  recordSale,
  restockVariant,
  saveCashCount,
  saveMoneySettings,
  saveShopDetails,
  taxSnapshot,
  topUpTaxPot,
  totalsForDay,
  voidSale,
} from '@/db/repos';
import { estimateTurnoverTax, potStatus, priceSale, validateOwnerAccount, normalisePhone, type TaxRules } from '@/core';
import { at, count, openBlankDb, openTestDb, stockOf, type TestDb } from '@/test/sqlite';

/**
 * System tests: whole journeys a shop goes through, run end to end across
 * migrations, the data layer and the domain rules together - the same calls
 * the screens make, in the order a real day makes them. Nothing is mocked
 * except the driver underneath SQLite.
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

async function insertMessage(provider: string, amount: number, receivedAt: string, reference: string | null) {
  const id = `mm_${amount}_${receivedAt}`;
  await db.runAsync(
    `INSERT INTO mobile_money_txn (id, provider, amount, sender, reference, received_at, raw_message, parsed, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Customer', ?, ?, 'raw', 1, 'unmatched', ?, ?)`,
    id, provider, amount, reference, receivedAt, receivedAt, receivedAt
  );
  return id;
}

describe('ST-01 first run: account, onboarding and first products', () => {
  it('takes a new owner from an empty phone to a shop ready to sell', async () => {
    // Account screen: the form is validated before anything is stored.
    const form = { name: 'Elton', phone: '+260 97 123 4567', pin: '4821', confirmPin: '4821' };
    expect(validateOwnerAccount(form)).toEqual([]);
    await createOwner(db, { id: 'owner_1', name: form.name, phone: normalisePhone(form.phone), pinHash: 'sha256$x$y' });

    expect(await getOnboardingState(db)).toMatchObject({ hasShop: false, onboardingComplete: false });

    // Step 1-2: shop and money.
    await saveShopDetails(db, { name: 'Chiwala Fashions', type: 'clothes', town: 'Lusaka', language: 'en', usesBarcodes: true });
    await saveMoneySettings(db, { providers: ['MTN', 'Airtel'], turnoverTaxRegistered: true, tpin: '1001234567' });
    await ensureTaxPeriod(db, rules, DAY);

    // Step 3: first products, one with a supplier code, one left to the app.
    const shoes = await createProduct(db, { name: 'School shoes', barcode: '6001234500018', buyPrice: 18000, sellPrice: 28000, openingQuantity: 6 });
    const shirt = await createProduct(db, { name: 'School shirt', buyPrice: 5000, sellPrice: 8000, openingQuantity: 10 });
    await completeOnboarding(db);

    expect(await getOnboardingState(db)).toEqual({ hasShop: true, onboardingComplete: true, hasProducts: true });
    expect(await getShop(db)).toMatchObject({ providers: ['MTN', 'Airtel'], tpin: '1001234567', usesBarcodes: true });
    expect(shirt.barcode).toMatch(/^20\d{11}$/);
    expect((await findVariantByBarcode(db, shirt.barcode!))?.productName).toBe('School shirt');
    expect((await findVariantByBarcode(db, '6001234500018'))?.variantId).toBe(shoes.variantId);
    expect((await getTaxPotView(db, DAY)).period?.dueOn).toBe('2026-12-14');
  });
});

describe('ST-02 a full trading day', () => {
  it('sells, voids, reconciles, counts cash and sets tax aside with consistent figures everywhere', async () => {
    await saveShopDetails(db, { name: 'Shop', type: 'general', town: 'Lusaka', language: 'en', usesBarcodes: false });
    await saveMoneySettings(db, { providers: ['MTN', 'Airtel', 'Zamtel'], turnoverTaxRegistered: true });
    await ensureTaxPeriod(db, rules, DAY);
    const shirt = await createProduct(db, { name: 'Shirt', buyPrice: 5000, sellPrice: 8000, openingQuantity: 10, lowStockLevel: 3 });
    const cap = await createProduct(db, { name: 'Cap', buyPrice: 2000, sellPrice: 4000, openingQuantity: 2, lowStockLevel: 1 });
    await db.runAsync(
      "INSERT INTO reconciliation (id, day, opening_float, created_at, updated_at) VALUES ('rec_open', ?, 10000, ?, ?)",
      DAY, at(DAY, '07:00'), at(DAY, '07:00')
    );

    const line = (variantId: string, quantity: number, buyPrice: number, sellPrice: number, lineDiscount = 0) => ({
      variantId, quantity, buyPrice, sellPrice, lineDiscount,
    });

    // 08:30 cash sale of 2 shirts.
    const s1 = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '08:30'),
      lines: [line(shirt.variantId, 2, 5000, 8000)],
      payments: [{ method: 'cash', amount: 16000 }],
    });
    // 09:15 MTN sale, no reference typed at the counter.
    const s2 = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '09:15'),
      lines: [line(cap.variantId, 1, 2000, 4000)],
      payments: [{ method: 'mobile_money', amount: 4000, provider: 'MTN' }],
    });
    // 11:00 split sale with a K10 counter discount.
    const s3 = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '11:00'),
      lines: [line(shirt.variantId, 1, 5000, 8000, 1000)],
      payments: [{ method: 'cash', amount: 2000 }, { method: 'mobile_money', amount: 5000, provider: 'Airtel', reference: 'AT-778' }],
    });
    // 12:00 Zamtel sale whose money never arrives.
    const s4 = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '12:00'),
      lines: [line(shirt.variantId, 1, 5000, 8000)],
      payments: [{ method: 'mobile_money', amount: 8000, provider: 'Zamtel' }],
    });
    // 13:00 a mistake, voided straight away.
    const s5 = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '13:00'),
      lines: [line(shirt.variantId, 3, 5000, 8000)],
      payments: [{ method: 'cash', amount: 24000 }],
    });
    await voidSale(db, s5.saleId, 'Rang up wrong item');

    // Cap is now at its low level; shirt has 10 - 2 - 1 - 1 = 6.
    expect(await stockOf(db, shirt.variantId)).toBe(6);
    expect(await stockOf(db, cap.variantId)).toBe(1);
    expect((await lowStockVariants(db)).map((row) => row.label)).toEqual(['Cap']);

    // Messages arrive on the shop phone.
    const mtn = await insertMessage('MTN', 4000, at(DAY, '09:16'), 'MP261117.0916');
    const airtel = await insertMessage('Airtel', 5000, at(DAY, '11:02'), ' at-778 ');
    const stray = await insertMessage('MTN', 15000, at(DAY, '15:00'), 'MP261117.1500');

    // The MTN message has a reference but the sale does not, so the rule
    // refuses to pair them; the owner confirms by hand.
    let day = await reconcileDay(db, DAY);
    expect(day.matched.map((m) => m.saleId)).toEqual([s3.saleId]);
    expect(day.salesWithoutPayment.map((s) => s.saleId).sort()).toEqual([s2.saleId, s4.saleId].sort());
    expect(day.paymentsWithoutSale.map((p) => p.txnId).sort()).toEqual([mtn, stray].sort());

    await markSalePaid(db, s2.saleId);
    await ignorePayment(db, mtn);
    await ignorePayment(db, stray);
    day = await reconcileDay(db, DAY);
    expect(day.matched.map((m) => m.saleId).sort()).toEqual([s2.saleId, s3.saleId].sort());
    expect(day.salesWithoutPayment.map((s) => s.saleId)).toEqual([s4.saleId]);
    expect(day.paymentsWithoutSale).toEqual([]);
    expect(airtel).toBeTruthy();

    // Cash: float 100 + cash sales 160 + 20 = K280; the void does not count.
    const cash = await saveCashCount(db, DAY, 27500, 'K5 short');
    expect(cash).toEqual({ expected: 28000, variance: -500 });

    // The Home figures agree with the sales recorded.
    const totals = await totalsForDay(db, DAY);
    expect(totals).toEqual({
      salesTotal: 16000 + 4000 + 7000 + 8000,
      saleCount: 4,
      discounts: 1000,
      cost: 10000 + 2000 + 5000 + 5000,
      grossProfit: 35000 - 22000,
    });

    // The Sales list shows every sale, newest first, with the void kept.
    const sales = await listSales(db);
    expect(sales.map((s) => s.id)).toEqual([s5, s4, s3, s2, s1].map((s) => s.saleId));
    expect(sales[0].status).toBe('void');

    // Tax: turnover matches Home, one sale is still unresolved.
    const snapshot = await taxSnapshot(db, DAY);
    expect(snapshot.turnover).toBe(totals.salesTotal);
    expect(snapshot.unresolvedSales).toBe(1);
    const estimate = estimateTurnoverTax(snapshot.turnover, rules);
    expect(estimate.estimatedTax).toBe(1400);
    expect(potStatus(estimate.estimatedTax, snapshot.potBalance).state).toBe('short');

    await topUpTaxPot(db, snapshot.period!.id, 1400);
    expect(potStatus(estimate.estimatedTax, (await taxSnapshot(db, DAY)).potBalance).state).toBe('covered');
    expect((await payTaxPot(db, snapshot.period!.id)).amount).toBe(1400);
    expect((await getTaxPotView(db, DAY)).potBalance).toBe(0);
  });
});

describe('ST-03 stock is always the sum of its history', () => {
  it('agrees with the movement log after sales, an override, a void and a restock', async () => {
    const { variantId } = await createProduct(db, { name: 'Belt', buyPrice: 1000, sellPrice: 2500, openingQuantity: 3 });
    const sale = (quantity: number, override = false) =>
      recordSale(db, {
        recordedBy: 'staff-1',
        lines: [{ variantId, quantity, buyPrice: 1000, sellPrice: 2500 }],
        payments: [{ method: 'cash', amount: 2500 * quantity }],
        override: override ? { approvedBy: 'owner_1', shortfalls: [{ variantId, onHand: 1, requested: quantity }] } : undefined,
      });

    await sale(2);
    const oversold = await sale(4, true);
    expect(await stockOf(db, variantId)).toBe(-3);
    await voidSale(db, oversold.saleId, 'Customer returned');
    await restockVariant(db, { variantId, quantity: 12, buyPrice: 1100 });

    const fromLog = await db.getFirstAsync<{ total: number }>(
      'SELECT SUM(quantity_change) AS total FROM stock_movement WHERE variant_id = ?', variantId
    );
    const [listed] = await listProductsWithStock(db);
    expect(listed.stock).toBe(13);
    expect(fromLog?.total).toBe(13);
    expect(listed.variants[0]).toMatchObject({ buyPrice: 1100, state: 'ok' });
  });
});

describe('ST-04 offline-first: everything the phone must upload is in the outbox', () => {
  it('queues every business record with a full, parseable payload and unique ids', async () => {
    await saveShopDetails(db, { name: 'Shop', type: 'general', town: 'Lusaka', language: 'en', usesBarcodes: true });
    await saveMoneySettings(db, { providers: ['MTN'], turnoverTaxRegistered: true });
    await ensureTaxPeriod(db, rules, DAY);
    const { variantId } = await createProduct(db, { name: 'Bag', buyPrice: 3000, sellPrice: 6000, openingQuantity: 5 });
    await restockVariant(db, { variantId, quantity: 2, buyPrice: 3200 });
    const { saleId } = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '10:00'),
      lines: [{ variantId, quantity: 1, buyPrice: 3200, sellPrice: 6000 }],
      payments: [{ method: 'mobile_money', amount: 6000, provider: 'MTN' }],
    });
    await reconcileDay(db, DAY);
    await markSalePaid(db, saleId);
    await voidSale(db, saleId, 'test');
    const period = (await taxSnapshot(db, DAY)).period!;
    await topUpTaxPot(db, period.id, 500);
    await payTaxPot(db, period.id);

    const queue = await db.getAllAsync<{ id: string; entity: string; operation: string; payload: string }>(
      'SELECT id, entity, operation, payload FROM sync_queue ORDER BY created_at, id'
    );
    expect(new Set(queue.map((row) => row.id)).size).toBe(queue.length);
    for (const row of queue) expect(() => JSON.parse(row.payload)).not.toThrow();

    const entities = new Set(queue.map((row) => row.entity));
    for (const entity of ['shop', 'tax_period', 'product', 'product_variant', 'stock_movement', 'sale', 'payment', 'tax_pot_entry']) {
      expect(entities, entity).toContain(entity);
    }

    // The sale create carries everything needed to rebuild it on the server.
    const create = queue.find((row) => row.entity === 'sale' && row.operation === 'create')!;
    const payload = JSON.parse(create.payload);
    expect(Object.keys(payload).sort()).toEqual(['lines', 'payments', 'sale', 'stockMovements']);

    // The void reverses exactly the movement the sale made, by deterministic id.
    const voidRow = queue.find((row) => row.entity === 'sale' && JSON.parse(row.payload).sale?.status === 'void')!;
    const reversal = JSON.parse(voidRow.payload).stockMovements[0];
    expect(reversal.id).toBe(`void-${payload.stockMovements[0].id}`);
    expect(reversal.quantityChange).toBe(1);
  });

  it('writes nothing at all, outbox included, when a sale is refused', async () => {
    const { variantId } = await createProduct(db, { name: 'Bag', buyPrice: 3000, sellPrice: 6000, openingQuantity: 1 });
    const before = await count(db, 'sync_queue');
    await expect(
      recordSale(db, {
        recordedBy: 'staff-1',
        lines: [{ variantId, quantity: 2, buyPrice: 3000, sellPrice: 6000 }],
        payments: [{ method: 'cash', amount: 12000 }],
      })
    ).rejects.toThrow();
    expect(await count(db, 'sync_queue')).toBe(before);
    expect(await count(db, 'sale')).toBe(0);
  });
});

describe('ST-05 upgrading an installed app', () => {
  it('upgrades a v1 database with a recorded sale to the latest schema without losing it', async () => {
    const old = openBlankDb();
    await old.execAsync(migrations[0]);
    await old.execAsync('PRAGMA user_version = 1');
    await old.execAsync(`
      INSERT INTO shop (id, name, type, town, created_at, updated_at) VALUES ('shop1', 'Old shop', 'general', 'Kitwe', 'x', 'x');
      INSERT INTO product (id, name, default_buy_price, default_sell_price, created_at, updated_at) VALUES ('p1', 'Soap', 500, 900, 'x', 'x');
      INSERT INTO product_variant (id, product_id, buy_price, sell_price, created_at, updated_at) VALUES ('v1', 'p1', 500, 900, 'x', 'x');
      INSERT INTO stock_movement (id, variant_id, quantity_change, reason, created_at, updated_at) VALUES ('m1', 'v1', 5, 'opening', 'x', 'x');
      INSERT INTO sale (id, recorded_by, subtotal, total, created_at, updated_at) VALUES ('s1', 'staff-1', 900, 900, '${at(DAY, '10:00')}', 'x');
      INSERT INTO payment (id, sale_id, method, provider, amount, created_at, updated_at) VALUES ('pay1', 's1', 'mobile_money', 'MTN', 900, 'x', 'x');
      INSERT INTO mobile_money_txn (id, provider, amount, received_at, raw_message, created_at, updated_at) VALUES ('t1', 'MTN', 900, '${at(DAY, '10:03')}', 'raw', 'x', 'x');
    `);

    await initializeDatabase(old);

    expect((await old.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(migrations.length);
    expect(await stockOf(old, 'v1')).toBe(5);
    // An upgraded shop has not been through the new onboarding flag yet.
    expect((await getShop(old))?.onboardingCompleted).toBe(false);
    // The new columns work on old rows.
    const result = await reconcileDay(old, DAY);
    expect(result.matched.map((m) => m.saleId)).toEqual(['s1']);
    expect((await getSaleDetail(old, 's1'))?.reconcileStatus).toBe('matched');
    old.close();
  });
});

describe('ST-06 demo shop', () => {
  it('seeds once on an empty phone and every screen query works on it', async () => {
    await seedDemoShop(db);
    const products = await count(db, 'product');
    await seedDemoShop(db);
    expect(await count(db, 'product')).toBe(products);
    expect(products).toBeGreaterThan(0);

    const listed = await listProductsWithStock(db);
    for (const product of listed) {
      for (const variant of product.variants) {
        expect(variant.quantity).toBe(await stockOf(db, variant.id));
      }
    }
    await expect(totalsForDay(db, DAY)).resolves.toBeTruthy();
    await expect(reconcileDay(db, DAY)).resolves.toBeTruthy();
    await expect(getTaxPotView(db, DAY)).resolves.toBeTruthy();

    // Every seeded sale's lines are internally consistent with its header.
    for (const sale of await listSales(db, 100)) {
      const detail = (await getSaleDetail(db, sale.id))!;
      const lineTotal = detail.lines.reduce((sum, l) => sum + l.finalPrice, 0);
      expect(lineTotal, sale.id).toBe(detail.total);
      expect(detail.subtotal - detail.discountTotal, sale.id).toBe(detail.total);
    }
  });
});

describe('ST-07 pricing at the counter matches what is stored', () => {
  it('stores exactly the figures the sale screen shows', async () => {
    const { variantId } = await createProduct(db, { name: 'Dress', buyPrice: 9000, sellPrice: 15000, openingQuantity: 5 });
    const lines = [
      { variantId, quantity: 2, buyPrice: 9000, sellPrice: 15000, productDiscount: { enabled: true, type: 'fixed' as const, value: 1000 } },
    ];
    const shown = priceSale(lines, new Date(at(DAY, '10:00')));
    const { saleId } = await recordSale(db, {
      recordedBy: 'staff-1', createdAt: at(DAY, '10:00'), lines,
      payments: [{ method: 'cash', amount: shown.total }],
    });
    const stored = (await getSaleDetail(db, saleId))!;
    expect(stored).toMatchObject({ subtotal: shown.subtotal, discountTotal: shown.discountTotal, total: shown.total });
    expect(stored.total).toBe(28000);
  });
});
