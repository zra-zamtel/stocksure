import type { SQLiteDatabase } from 'expo-sqlite';
import {
  generateInStoreBarcode,
  localDayBounds,
  needsOverride,
  newId,
  normaliseBarcode,
  nowIso,
  priceSale,
  reversalFor,
  stockState,
  todayLocal,
  validatePayments,
  validateRestock,
  type LineInput,
  type Ngwee,
  type PaymentInput,
  type ProductDiscount,
  type StockMovement,
  type StockState,
} from '@/core';

/** SQL fragment: column falls in [?, ?). julianday() copes with both Z and +02:00 stamps. */
const inRange = (column: string) =>
  `julianday(${column}) >= julianday(?) AND julianday(${column}) < julianday(?)`;

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
  discount?: ProductDiscount;
  stock: number;
  variants: VariantWithStock[];
}

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  defaultBuyPrice: number;
  defaultSellPrice: number;
  discountJson: string | null;
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
            p.discount_json AS discountJson,
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
        discount: row.discountJson ? (JSON.parse(row.discountJson) as ProductDiscount) : undefined,
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
        state: stockState(quantity, lowStockLevel),
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
  const [start, end] = localDayBounds(day);
  const totals = await db.getFirstAsync<{
    salesTotal: number;
    saleCount: number;
    discounts: number;
    cost: number;
  }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sale WHERE status = 'active' AND ${inRange('created_at')}), 0) AS salesTotal,
       COALESCE((SELECT COUNT(*) FROM sale WHERE status = 'active' AND ${inRange('created_at')}), 0) AS saleCount,
       COALESCE((SELECT SUM(discount_total) FROM sale WHERE status = 'active' AND ${inRange('created_at')}), 0) AS discounts,
       COALESCE((SELECT SUM(l.buy_price * l.quantity)
                   FROM sale_line l
                   JOIN sale s ON s.id = l.sale_id
                  WHERE s.status = 'active' AND ${inRange('s.created_at')}), 0) AS cost`,
    start,
    end,
    start,
    end,
    start,
    end,
    start,
    end
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
  /** Set only after the owner has approved selling more than is on hand. */
  allowNegativeStock?: boolean;
}

export interface StockShortfall {
  variantId: string;
  onHand: number;
  requested: number;
}

export class InsufficientStockError extends Error {
  constructor(public readonly shortfalls: StockShortfall[]) {
    super('Not enough stock for this sale. The owner must approve an override.');
    this.name = 'InsufficientStockError';
  }
}

export interface RecordedSale {
  saleId: string;
  total: Ngwee;
  belowCost: { variantId: string; finalPrice: Ngwee }[];
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
  const requested = new Map<string, number>();
  for (const line of priced.lines) {
    requested.set(line.variantId, (requested.get(line.variantId) ?? 0) + line.quantity);
  }

  await db.withTransactionAsync(async () => {
    if (!input.allowNegativeStock) {
      const shortfalls: StockShortfall[] = [];
      for (const [variantId, quantity] of requested) {
        const row = await db.getFirstAsync<{ quantity: number }>(
          'SELECT quantity FROM variant_stock WHERE variant_id = ?',
          variantId
        );
        const onHand = row?.quantity ?? 0;
        if (needsOverride(onHand, quantity)) shortfalls.push({ variantId, onHand, requested: quantity });
      }
      if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);
    }

    const syncLines: object[] = [];
    const syncMovements: object[] = [];
    const syncPayments: object[] = [];

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
      const lineId = newId('line');
      const movementId = newId('mv');
      syncLines.push({
        id: lineId,
        saleId,
        variantId: line.variantId,
        quantity: line.quantity,
        buyPrice: line.buyPrice,
        listPrice: line.listPrice,
        discount: line.discount,
        finalPrice: line.finalPrice,
        createdAt,
        updatedAt: createdAt,
      });
      syncMovements.push({
        id: movementId,
        variantId: line.variantId,
        quantityChange: -line.quantity,
        reason: 'sale',
        saleId,
        createdAt,
        updatedAt: createdAt,
      });

      await db.runAsync(
        `INSERT INTO sale_line (id, sale_id, variant_id, quantity, buy_price, list_price, discount, final_price, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        lineId,
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
        movementId,
        line.variantId,
        -line.quantity,
        saleId,
        createdAt,
        createdAt
      );
    }

    for (const payment of input.payments) {
      const paymentId = newId('pay');
      syncPayments.push({
        id: paymentId,
        saleId,
        method: payment.method,
        provider: payment.provider ?? null,
        amount: payment.amount,
        mobileMoneyReference: payment.reference ?? null,
        createdAt,
        updatedAt: createdAt,
      });

      await db.runAsync(
        `INSERT INTO payment (id, sale_id, method, provider, amount, mobile_money_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        paymentId,
        saleId,
        payment.method,
        payment.provider ?? null,
        payment.amount,
        payment.reference ?? null,
        createdAt,
        createdAt
      );
    }

    // Full rows, per docs/sync-contract.md, so the backend can validate and rebuild the sale.
    await enqueueSync(db, 'sale', saleId, 'create', {
      sale: {
        id: saleId,
        recordedBy: input.recordedBy,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        total: priced.total,
        status: 'active',
        reconcileStatus: 'unresolved',
        createdAt,
        updatedAt: createdAt,
      },
      lines: syncLines,
      payments: syncPayments,
      stockMovements: syncMovements,
    });
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

/**
 * Voiding keeps the sale and restores stock with linked reversing movements.
 * The status flip is the guard: it only succeeds while the sale is active, so a
 * second void (double tap, replay) changes nothing and restores nothing.
 */
export async function voidSale(db: SQLiteDatabase, saleId: string, reason: string): Promise<void> {
  const stamp = nowIso();

  await db.withTransactionAsync(async () => {
    const flipped = await db.runAsync(
      `UPDATE sale SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
      reason,
      stamp,
      saleId
    );
    if (flipped.changes === 0) {
      const exists = await db.getFirstAsync('SELECT 1 FROM sale WHERE id = ?', saleId);
      throw new Error(exists ? 'Sale is already void' : 'Sale not found');
    }

    const saleMovements = await db.getAllAsync<StockMovement>(
      `SELECT id, variant_id AS variantId, quantity_change AS quantityChange, reason, note,
              sale_id AS saleId, created_at AS createdAt, updated_at AS updatedAt
         FROM stock_movement
        WHERE sale_id = ? AND reason = 'sale'`,
      saleId
    );
    const reversals = reversalFor(saleMovements, saleId, stamp, reason);

    for (const movement of reversals) {
      await db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, note, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, 'void', ?, ?, ?, ?)`,
        movement.id,
        movement.variantId,
        movement.quantityChange,
        movement.note ?? null,
        saleId,
        movement.createdAt,
        movement.updatedAt
      );
    }

    await enqueueSync(db, 'sale', saleId, 'update', {
      sale: { id: saleId, status: 'void', voidReason: reason, updatedAt: stamp },
      stockMovements: reversals,
    });
  });
}

export interface ShopRecord {
  id: string;
  name: string;
  type: string;
  town: string;
  language: 'en' | 'ny';
  usesBarcodes: boolean;
  lowStockDefault: number;
  turnoverTaxRegistered: boolean;
  tpin?: string;
  providers: string[];
}

export async function getShop(db: SQLiteDatabase): Promise<ShopRecord | null> {
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    type: string;
    town: string;
    language: 'en' | 'ny';
    usesBarcodes: number;
    lowStockDefault: number;
    turnoverTaxRegistered: number;
    tpin: string | null;
    providersJson: string;
  }>(
    `SELECT id, name, type, town, language, uses_barcodes AS usesBarcodes,
            low_stock_default AS lowStockDefault, turnover_tax_registered AS turnoverTaxRegistered,
            tpin, providers_json AS providersJson
       FROM shop LIMIT 1`
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    town: row.town,
    language: row.language,
    usesBarcodes: row.usesBarcodes === 1,
    lowStockDefault: row.lowStockDefault,
    turnoverTaxRegistered: row.turnoverTaxRegistered === 1,
    tpin: row.tpin ?? undefined,
    providers: JSON.parse(row.providersJson) as string[],
  };
}

export interface BarcodeMatch {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
}

/** Finds the product a scanned code belongs to, if it belongs to one. */
export async function findVariantByBarcode(
  db: SQLiteDatabase,
  barcode: string
): Promise<BarcodeMatch | null> {
  const normalised = normaliseBarcode(barcode);
  const row = await db.getFirstAsync<{
    variantId: string;
    productId: string;
    productName: string;
    size: string | null;
    colour: string | null;
  }>(
    `SELECT v.id AS variantId, p.id AS productId, p.name AS productName, v.size, v.colour
       FROM product_variant v
       JOIN product p ON p.id = v.product_id
      WHERE v.barcode = ? OR v.barcode = ?
      LIMIT 1`,
    normalised,
    barcode.trim()
  );
  if (!row) return null;
  return {
    variantId: row.variantId,
    productId: row.productId,
    productName: row.productName,
    variantLabel: [row.size, row.colour].filter(Boolean).join(' · ') || 'Single',
  };
}

export interface CreateProductInput {
  name: string;
  category?: string;
  barcode?: string;
  buyPrice: Ngwee;
  sellPrice: Ngwee;
  openingQuantity: number;
  lowStockLevel?: number;
}

/**
 * Creates a product with a single variant and its opening stock. Sizes and
 * colours as extra variants land with #30; this is the demo-path shape.
 */
export async function createProduct(
  db: SQLiteDatabase,
  input: CreateProductInput
): Promise<{ productId: string; variantId: string; barcode?: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('Product name is required');
  if (input.buyPrice < 0 || input.sellPrice < 0) throw new Error('Prices cannot be negative');
  if (!Number.isInteger(input.openingQuantity) || input.openingQuantity < 0) {
    throw new Error('Opening quantity must be a whole number, zero or more');
  }

  const barcode = input.barcode?.trim() ? normaliseBarcode(input.barcode) : await autoBarcode(db);
  if (barcode) {
    const clash = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM product_variant WHERE barcode = ?',
      barcode
    );
    if (clash) throw new Error('That barcode already belongs to another product');
  }

  const productId = newId('prod');
  const variantId = newId('var');
  const stamp = nowIso();
  const lowStockLevel = input.lowStockLevel ?? 3;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO product (id, name, category, default_buy_price, default_sell_price, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      productId,
      name,
      input.category?.trim() || null,
      input.buyPrice,
      input.sellPrice,
      stamp,
      stamp
    );

    await db.runAsync(
      `INSERT INTO product_variant (id, product_id, barcode, buy_price, sell_price, low_stock_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      variantId,
      productId,
      barcode ?? null,
      input.buyPrice,
      input.sellPrice,
      lowStockLevel,
      stamp,
      stamp
    );

    if (input.openingQuantity > 0) {
      await db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, created_at, updated_at)
         VALUES (?, ?, ?, 'opening', ?, ?)`,
        newId('mv'),
        variantId,
        input.openingQuantity,
        stamp,
        stamp
      );
    }

    await enqueueSync(db, 'product', productId, 'create', {
      id: productId,
      name,
      category: input.category?.trim() || null,
      defaultBuyPrice: input.buyPrice,
      defaultSellPrice: input.sellPrice,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await enqueueSync(db, 'product_variant', variantId, 'create', {
      id: variantId,
      productId,
      barcode: barcode ?? null,
      buyPrice: input.buyPrice,
      sellPrice: input.sellPrice,
      lowStockLevel,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });

  return { productId, variantId, barcode };
}

/**
 * A shop that uses barcodes should never end up with a product that has none,
 * so a missing code is allocated automatically instead of being nagged for.
 * Only shops with barcodes switched on get one; for the others the field stays
 * empty on purpose.
 */
async function autoBarcode(db: SQLiteDatabase): Promise<string | undefined> {
  const shop = await getShop(db);
  if (!shop?.usesBarcodes) return undefined;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInStoreBarcode();
    const clash = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM product_variant WHERE barcode = ?',
      candidate
    );
    if (!clash) return candidate;
  }
  throw new Error('Could not allocate a unique barcode');
}

/** Adds a barcode to a product that was created without one. */
export async function setVariantBarcode(
  db: SQLiteDatabase,
  variantId: string,
  barcode?: string
): Promise<string> {
  const next = barcode?.trim() ? normaliseBarcode(barcode) : await autoBarcode(db);
  if (!next) throw new Error('This shop does not use barcodes');

  const clash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM product_variant WHERE barcode = ? AND id <> ?',
    next,
    variantId
  );
  if (clash) throw new Error('That barcode already belongs to another product');

  const stamp = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE product_variant SET barcode = ?, updated_at = ? WHERE id = ?',
      next,
      stamp,
      variantId
    );
    await enqueueSync(db, 'product_variant', variantId, 'update', {
      id: variantId,
      barcode: next,
      updatedAt: stamp,
    });
  });

  return next;
}

export interface RestockInput {
  variantId: string;
  quantity: number;
  buyPrice?: Ngwee;
  note?: string;
}

export interface RestockedStock {
  variantId: string;
  quantityAdded: number;
  buyPrice: Ngwee;
  quantityOnHand: number;
}

/**
 * Adds stock and, in the same step, updates the buy price. The price change only
 * affects future sales: past sale lines keep the cost they were sold at.
 */
export async function restockVariant(db: SQLiteDatabase, input: RestockInput): Promise<RestockedStock> {
  const errors = validateRestock(input.quantity, input.buyPrice);
  if (errors.length > 0) throw new Error(errors.join('. '));

  const variant = await db.getFirstAsync<{ buyPrice: number }>(
    'SELECT buy_price AS buyPrice FROM product_variant WHERE id = ?',
    input.variantId
  );
  if (!variant) throw new Error('Product variant not found');

  const stamp = nowIso();
  const movementId = newId('mv');
  const buyPrice = input.buyPrice ?? variant.buyPrice;
  const priceChanged = buyPrice !== variant.buyPrice;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, note, created_at, updated_at)
       VALUES (?, ?, ?, 'restock', ?, ?, ?)`,
      movementId,
      input.variantId,
      input.quantity,
      input.note ?? null,
      stamp,
      stamp
    );

    if (priceChanged) {
      await db.runAsync(
        'UPDATE product_variant SET buy_price = ?, updated_at = ? WHERE id = ?',
        buyPrice,
        stamp,
        input.variantId
      );
    }

    await enqueueSync(db, 'stock_movement', movementId, 'create', {
      id: movementId,
      variantId: input.variantId,
      quantityChange: input.quantity,
      reason: 'restock',
      note: input.note ?? null,
      createdAt: stamp,
      updatedAt: stamp,
    });

    if (priceChanged) {
      await enqueueSync(db, 'product_variant', input.variantId, 'update', {
        id: input.variantId,
        buyPrice,
        updatedAt: stamp,
      });
    }
  });

  const row = await db.getFirstAsync<{ quantity: number }>(
    'SELECT quantity FROM variant_stock WHERE variant_id = ?',
    input.variantId
  );

  return {
    variantId: input.variantId,
    quantityAdded: input.quantity,
    buyPrice,
    quantityOnHand: row?.quantity ?? 0,
  };
}

export interface MovementRow {
  id: string;
  quantityChange: number;
  reason: string;
  note?: string;
  createdAt: string;
}

export async function listMovements(
  db: SQLiteDatabase,
  variantId: string,
  limit = 20
): Promise<MovementRow[]> {
  return db.getAllAsync<MovementRow>(
    `SELECT id, quantity_change AS quantityChange, reason, note, created_at AS createdAt
       FROM stock_movement
      WHERE variant_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    variantId,
    limit
  );
}

export interface SaleDetail {
  id: string;
  createdAt: string;
  subtotal: Ngwee;
  discountTotal: Ngwee;
  total: Ngwee;
  status: 'active' | 'void';
  voidReason?: string;
  reconcileStatus: string;
  lines: {
    id: string;
    label: string;
    quantity: number;
    buyPrice: Ngwee;
    listPrice: Ngwee;
    discount: Ngwee;
    finalPrice: Ngwee;
  }[];
  payments: {
    id: string;
    method: string;
    provider?: string;
    amount: Ngwee;
    reference?: string;
  }[];
}

/** One sale with its lines and payments, for the detail screen. */
export async function getSaleDetail(db: SQLiteDatabase, saleId: string): Promise<SaleDetail | null> {
  const sale = await db.getFirstAsync<{
    id: string;
    createdAt: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    status: 'active' | 'void';
    voidReason: string | null;
    reconcileStatus: string;
  }>(
    `SELECT id, created_at AS createdAt, subtotal, discount_total AS discountTotal, total,
            status, void_reason AS voidReason, reconcile_status AS reconcileStatus
       FROM sale WHERE id = ?`,
    saleId
  );
  if (!sale) return null;

  const lines = await db.getAllAsync<SaleDetail['lines'][number]>(
    `SELECT l.id,
            TRIM(p.name || ' ' || COALESCE(v.size, '') || ' ' || COALESCE(v.colour, '')) AS label,
            l.quantity, l.buy_price AS buyPrice, l.list_price AS listPrice,
            l.discount, l.final_price AS finalPrice
       FROM sale_line l
       JOIN product_variant v ON v.id = l.variant_id
       JOIN product p ON p.id = v.product_id
      WHERE l.sale_id = ?
      ORDER BY l.id`,
    saleId
  );

  const payments = await db.getAllAsync<SaleDetail['payments'][number]>(
    `SELECT id, method, provider, amount, mobile_money_reference AS reference
       FROM payment WHERE sale_id = ? ORDER BY id`,
    saleId
  );

  return {
    id: sale.id,
    createdAt: sale.createdAt,
    subtotal: sale.subtotal,
    discountTotal: sale.discountTotal,
    total: sale.total,
    status: sale.status,
    voidReason: sale.voidReason ?? undefined,
    reconcileStatus: sale.reconcileStatus,
    lines,
    payments,
  };
}

export interface TaxPeriodRef {
  id: string;
  startsOn: string;
  endsOn: string;
  dueOn: string;
}

export interface TaxSnapshot {
  turnover: Ngwee;
  potBalance: Ngwee;
  period: TaxPeriodRef | null;
}

/**
 * Turnover and pot for the current tax period only: the one covering today, or
 * the latest one if none does. Turnover tax is assessed per period, so an
 * all-time sum would eventually cross the threshold and hide the estimate.
 */
export async function taxSnapshot(db: SQLiteDatabase, today: string = todayLocal()): Promise<TaxSnapshot> {
  const period = await db.getFirstAsync<TaxPeriodRef>(
    `SELECT id, starts_on AS startsOn, ends_on AS endsOn, due_on AS dueOn
       FROM tax_period
      ORDER BY (? BETWEEN starts_on AND ends_on) DESC, starts_on DESC
      LIMIT 1`,
    today
  );
  if (!period) return { turnover: 0, potBalance: 0, period: null };

  const [start] = localDayBounds(period.startsOn);
  const [, end] = localDayBounds(period.endsOn);
  const row = await db.getFirstAsync<{ turnover: number; potBalance: number }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sale WHERE status = 'active' AND ${inRange('created_at')}), 0) AS turnover,
       COALESCE((SELECT SUM(CASE WHEN kind = 'paid' THEN -amount ELSE amount END)
                   FROM tax_pot_entry
                  WHERE period_id = ?), 0) AS potBalance`,
    start,
    end,
    period.id
  );
  return { turnover: row?.turnover ?? 0, potBalance: row?.potBalance ?? 0, period };
}

/** Cash at closing is upserted per day, with expected cash derived, not typed. */
export async function saveCashCount(
  db: SQLiteDatabase,
  day: string,
  countedCash: Ngwee,
  note?: string
): Promise<{ expected: Ngwee; variance: Ngwee }> {
  const [start, end] = localDayBounds(day);
  const cash = await db.getFirstAsync<{ cashSales: number; openingFloat: number | null }>(
    `SELECT
       COALESCE((SELECT SUM(p.amount)
                   FROM payment p
                   JOIN sale s ON s.id = p.sale_id
                  WHERE p.method = 'cash' AND s.status = 'active' AND ${inRange('s.created_at')}), 0) AS cashSales,
       (SELECT opening_float FROM reconciliation WHERE day = ?) AS openingFloat`,
    start,
    end,
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

/** Every write also lands here. Idempotent on replay because the ID is local. */
export async function enqueueSync(
  db: SQLiteDatabase,
  entity: string,
  entityId: string,
  operation: 'create' | 'update',
  payload: unknown
): Promise<void> {
  const stamp = nowIso();
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entity_id, operation, payload, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    newId('q'),
    entity,
    entityId,
    operation,
    JSON.stringify(payload),
    stamp,
    stamp
  );
}
