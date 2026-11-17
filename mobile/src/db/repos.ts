import type { SQLiteDatabase } from 'expo-sqlite';
import {
  newId,
  nowIso,
  priceSale,
  validatePayments,
  type LineInput,
  type Ngwee,
  type PaymentInput,
  type StockState,
} from '@/core';

/**
 * Data access. Screens call these, never SQL directly. Everything that changes
 * money or stock runs in a transaction and writes a sync queue row, so the
 * outbox can replay it later.
 */

export interface VariantWithStock {
  id: string;
  size?: string;
  colour?: string;
  barcode?: string;
  buyPrice: Ngwee;
  sellPrice: Ngwee;
  lowStockLevel: number;
  quantity: number;
  state: StockState;
}

export interface ProductWithStock {
  id: string;
  name: string;
  category?: string;
  defaultBuyPrice: Ngwee;
  defaultSellPrice: Ngwee;
  stock: number;
  variants: VariantWithStock[];
}

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  defaultBuyPrice: number;
  defaultSellPrice: number;
  variantId: string | null;
  size: string | null;
  colour: string | null;
  barcode: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  lowStockLevel: number | null;
  quantity: number | null;
}

export async function listProductsWithStock(db: SQLiteDatabase): Promise<ProductWithStock[]> {
  const rows = await db.getAllAsync<ProductRow>(
    `SELECT p.id, p.name, p.category,
            p.default_buy_price AS defaultBuyPrice,
            p.default_sell_price AS defaultSellPrice,
            v.id AS variantId, v.size, v.colour, v.barcode,
            v.buy_price AS buyPrice, v.sell_price AS sellPrice,
            v.low_stock_level AS lowStockLevel,
            COALESCE(s.quantity, 0) AS quantity
       FROM product p
       LEFT JOIN product_variant v ON v.product_id = p.id
       LEFT JOIN variant_stock s ON s.variant_id = v.id
      ORDER BY p.name, v.size, v.colour`
  );

  const byProduct = new Map<string, ProductWithStock>();
  for (const row of rows) {
    let product = byProduct.get(row.id);
    if (!product) {
      product = {
        id: row.id,
        name: row.name,
        category: row.category ?? undefined,
        defaultBuyPrice: row.defaultBuyPrice,
        defaultSellPrice: row.defaultSellPrice,
        stock: 0,
        variants: [],
      };
      byProduct.set(row.id, product);
    }
    if (row.variantId) {
      const quantity = row.quantity ?? 0;
      const lowStockLevel = row.lowStockLevel ?? 0;
      product.variants.push({
        id: row.variantId,
        size: row.size ?? undefined,
        colour: row.colour ?? undefined,
        barcode: row.barcode ?? undefined,
        buyPrice: row.buyPrice ?? 0,
        sellPrice: row.sellPrice ?? 0,
        lowStockLevel,
        quantity,
        state: quantity <= 0 ? 'out' : quantity <= lowStockLevel ? 'low' : 'ok',
      });
      product.stock += quantity;
    }
  }

  return [...byProduct.values()];
}

export interface SaleSummary {
  id: string;
  createdAt: string;
  total: Ngwee;
  status: 'active' | 'void';
  reconcileStatus: string;
}

export async function listSales(db: SQLiteDatabase, limit = 50): Promise<SaleSummary[]> {
  return db.getAllAsync<SaleSummary>(
    `SELECT id, created_at AS createdAt, total, status, reconcile_status AS reconcileStatus
       FROM sale
      ORDER BY created_at DESC
      LIMIT ?`,
    limit
  );
}

export interface DayTotals {
  salesTotal: Ngwee;
  saleCount: number;
  discounts: Ngwee;
  cost: Ngwee;
  grossProfit: Ngwee;
}

export async function totalsForDay(db: SQLiteDatabase, day: string): Promise<DayTotals> {
  const totals = await db.getFirstAsync<{
    salesTotal: number;
    saleCount: number;
    discounts: number;
    cost: number;
  }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sale WHERE status = 'active' AND date(created_at) = date(?)), 0) AS salesTotal,
       COALESCE((SELECT COUNT(*) FROM sale WHERE status = 'active' AND date(created_at) = date(?)), 0) AS saleCount,
       COALESCE((SELECT SUM(discount_total) FROM sale WHERE status = 'active' AND date(created_at) = date(?)), 0) AS discounts,
       COALESCE((SELECT SUM(l.buy_price * l.quantity)
                   FROM sale_line l
                   JOIN sale s ON s.id = l.sale_id
                  WHERE s.status = 'active' AND date(s.created_at) = date(?)), 0) AS cost`,
    day,
    day,
    day,
    day
  );

  const salesTotal = totals?.salesTotal ?? 0;
  const cost = totals?.cost ?? 0;
  return {
    salesTotal,
    saleCount: totals?.saleCount ?? 0,
    discounts: totals?.discounts ?? 0,
    cost,
    grossProfit: salesTotal - cost,
  };
}

export interface LowStockRow {
  variantId: string;
  label: string;
  quantity: number;
  lowStockLevel: number;
}

export async function lowStockVariants(db: SQLiteDatabase): Promise<LowStockRow[]> {
  return db.getAllAsync<LowStockRow>(
    `SELECT v.id AS variantId,
            TRIM(p.name || ' ' || COALESCE(v.size, '') || ' ' || COALESCE(v.colour, '')) AS label,
            COALESCE(s.quantity, 0) AS quantity,
            v.low_stock_level AS lowStockLevel
       FROM product_variant v
       JOIN product p ON p.id = v.product_id
       JOIN variant_stock s ON s.variant_id = v.id
      WHERE s.quantity <= v.low_stock_level
      ORDER BY s.quantity ASC, p.name ASC`
  );
}

export interface RecordSaleInput {
  recordedBy: string;
  lines: LineInput[];
  payments: PaymentInput[];
  createdAt?: string;
}

export interface RecordedSale {
  saleId: string;
  total: Ngwee;
  belowCost: Array<{ variantId: string; finalPrice: Ngwee }>;
}

/**
 * Writes the sale, its lines, its payments and the stock movements that take
 * stock down - all in one transaction, so a half-recorded sale can never exist.
 */
export async function recordSale(db: SQLiteDatabase, input: RecordSaleInput): Promise<RecordedSale> {
  const createdAt = input.createdAt ?? nowIso();
  const priced = priceSale(input.lines, new Date(createdAt));

  const errors = validatePayments(priced.total, input.payments);
  if (errors.length > 0) throw new Error(errors.join('. '));

  const saleId = newId('sale');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sale (id, recorded_by, subtotal, discount_total, total, status, reconcile_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'unresolved', ?, ?)`,
      saleId,
      input.recordedBy,
      priced.subtotal,
      priced.discountTotal,
      priced.total,
      createdAt,
      createdAt
    );

    for (const line of priced.lines) {
      await db.runAsync(
        `INSERT INTO sale_line (id, sale_id, variant_id, quantity, buy_price, list_price, discount, final_price, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('line'),
        saleId,
        line.variantId,
        line.quantity,
        line.buyPrice,
        line.listPrice,
        line.discount,
        line.finalPrice,
        createdAt,
        createdAt
      );

      await db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, 'sale', ?, ?, ?)`,
        newId('mv'),
        line.variantId,
        -line.quantity,
        saleId,
        createdAt,
        createdAt
      );
    }

    for (const payment of input.payments) {
      await db.runAsync(
        `INSERT INTO payment (id, sale_id, method, provider, amount, mobile_money_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('pay'),
        saleId,
        payment.method,
        payment.provider ?? null,
        payment.amount,
        payment.reference ?? null,
        createdAt,
        createdAt
      );
    }

    await enqueueSync(db, 'sale', saleId, 'create', { saleId, total: priced.total });
  });

  return {
    saleId,
    total: priced.total,
    belowCost: priced.belowCostLines.map((line) => ({
      variantId: line.variantId,
      finalPrice: line.finalPrice,
    })),
  };
}

/** Voiding keeps the sale and restores stock with a linked reversing movement. */
export async function voidSale(db: SQLiteDatabase, saleId: string, reason: string): Promise<void> {
  const sale = await db.getFirstAsync<{ status: string }>('SELECT status FROM sale WHERE id = ?', saleId);
  if (!sale) throw new Error('Sale not found');
  if (sale.status === 'void') throw new Error('Sale is already void');

  const lines = await db.getAllAsync<{ variant_id: string; quantity: number }>(
    'SELECT variant_id, quantity FROM sale_line WHERE sale_id = ?',
    saleId
  );
  const stamp = nowIso();

  await db.withTransactionAsync(async () => {
    for (const line of lines) {
      await db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, note, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, 'void', ?, ?, ?, ?)`,
        newId('mv'),
        line.variant_id,
        line.quantity,
        reason,
        saleId,
        stamp,
        stamp
      );
    }

    await db.runAsync(
      `UPDATE sale SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ?`,
      reason,
      stamp,
      saleId
    );

    await enqueueSync(db, 'sale', saleId, 'update', { saleId, status: 'void' });
  });
}

export interface TaxSnapshot {
  turnover: Ngwee;
  potBalance: Ngwee;
}

export async function taxSnapshot(db: SQLiteDatabase): Promise<TaxSnapshot> {
  const row = await db.getFirstAsync<{ turnover: number; potBalance: number }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sale WHERE status = 'active'), 0) AS turnover,
       COALESCE((SELECT SUM(CASE WHEN kind = 'paid' THEN -amount ELSE amount END) FROM tax_pot_entry), 0) AS potBalance`
  );
  return { turnover: row?.turnover ?? 0, potBalance: row?.potBalance ?? 0 };
}

/** Cash at closing is upserted per day, with expected cash derived, not typed. */
export async function saveCashCount(
  db: SQLiteDatabase,
  day: string,
  countedCash: Ngwee,
  note?: string
): Promise<{ expected: Ngwee; variance: Ngwee }> {
  const cash = await db.getFirstAsync<{ cashSales: number; openingFloat: number | null }>(
    `SELECT
       COALESCE((SELECT SUM(p.amount)
                   FROM payment p
                   JOIN sale s ON s.id = p.sale_id
                  WHERE p.method = 'cash' AND s.status = 'active' AND date(s.created_at) = date(?)), 0) AS cashSales,
       (SELECT opening_float FROM reconciliation WHERE day = ?) AS openingFloat`,
    day,
    day
  );

  const openingFloat = cash?.openingFloat ?? 0;
  const expected = openingFloat + (cash?.cashSales ?? 0);
  const variance = countedCash - expected;
  const stamp = nowIso();

  await db.runAsync(
    `INSERT INTO reconciliation (id, day, opening_float, counted_cash, expected_cash, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       counted_cash = excluded.counted_cash,
       expected_cash = excluded.expected_cash,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    newId('rec'),
    day,
    openingFloat,
    countedCash,
    expected,
    note ?? null,
    stamp,
    stamp
  );

  return { expected, variance };
}

let queueCounter = 0;

/** Every write also lands here. Idempotent on replay because the ID is local. */
export async function enqueueSync(
  db: SQLiteDatabase,
  entity: string,
  entityId: string,
  operation: 'create' | 'update',
  payload: unknown
): Promise<void> {
  queueCounter += 1;
  const stamp = nowIso();
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entity_id, operation, payload, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    newId(`q${queueCounter}`),
    entity,
    entityId,
    operation,
    JSON.stringify(payload),
    stamp,
    stamp
  );
}
