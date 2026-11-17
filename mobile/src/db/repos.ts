import type { SQLiteDatabase } from 'expo-sqlite';
import {
  cashVariance,
  generateInStoreBarcode,
  isValidPhone,
  localDayBounds,
  matchPayments,
  needsOverride,
  newId,
  normaliseBarcode,
  normalisePhone,
  nowIso,
  priceSale,
  reversalFor,
  stockState,
  taxPeriodForMonth,
  todayLocal,
  validatePayments,
  validateRestock,
  type LineInput,
  type Ngwee,
  type PaymentInput,
  type ProductDiscount,
  type Role,
  type ShopType,
  type StockMovement,
  type StockState,
  type TaxRules,
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

/** A bad discount on one product must not stop every product screen loading. */
function parseDiscount(json: string | null): ProductDiscount | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as ProductDiscount;
  } catch {
    return undefined;
  }
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
        discount: parseDiscount(row.discountJson),
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
  recordedByName: string;
}

export async function listSales(db: SQLiteDatabase, limit = 50): Promise<SaleSummary[]> {
  return db.getAllAsync<SaleSummary>(
    `SELECT s.id, s.created_at AS createdAt, s.total, s.status, s.reconcile_status AS reconcileStatus,
            COALESCE(o.name, st.name, s.recorded_by) AS recordedByName
       FROM sale s
       LEFT JOIN owner o ON o.id = s.recorded_by
       LEFT JOIN staff st ON st.id = s.recorded_by
      ORDER BY s.created_at DESC
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
  override?: StockOverride;
}

/**
 * Approval to sell below stock. It covers only the shortfalls that were shown
 * when it was given, so a basket changed afterwards is checked again.
 */
export interface StockOverride {
  approvedBy: string;
  shortfalls: StockShortfall[];
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
    const shortfalls: StockShortfall[] = [];
    for (const [variantId, quantity] of requested) {
      const row = await db.getFirstAsync<{ quantity: number }>(
        'SELECT quantity FROM variant_stock WHERE variant_id = ?',
        variantId
      );
      const onHand = row?.quantity ?? 0;
      if (needsOverride(onHand, quantity)) shortfalls.push({ variantId, onHand, requested: quantity });
    }
    const approved = new Map(input.override?.shortfalls.map((item) => [item.variantId, item.requested]));
    const unapproved = shortfalls.filter((item) => (approved.get(item.variantId) ?? -1) < item.requested);
    if (unapproved.length > 0) throw new InsufficientStockError(shortfalls);

    // Overridden lines say so in stock history, with who approved it.
    const overrideNotes = new Map(
      shortfalls.map((item) => [
        item.variantId,
        `Override by ${input.override?.approvedBy}: sold ${item.requested} with ${item.onHand} on hand`,
      ])
    );

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
        note: overrideNotes.get(line.variantId) ?? null,
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
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, note, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
        movementId,
        line.variantId,
        -line.quantity,
        overrideNotes.get(line.variantId) ?? null,
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
  type: ShopType;
  town: string;
  language: 'en' | 'ny';
  usesBarcodes: boolean;
  lowStockDefault: number;
  turnoverTaxRegistered: boolean;
  tpin?: string;
  providers: string[];
  onboardingCompleted: boolean;
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
    onboardingCompleted: number;
  }>(
    `SELECT id, name, type, town, language, uses_barcodes AS usesBarcodes,
            low_stock_default AS lowStockDefault, turnover_tax_registered AS turnoverTaxRegistered,
            tpin, providers_json AS providersJson, onboarding_completed AS onboardingCompleted
       FROM shop LIMIT 1`
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type as ShopType,
    town: row.town,
    language: row.language,
    usesBarcodes: row.usesBarcodes === 1,
    lowStockDefault: row.lowStockDefault,
    turnoverTaxRegistered: row.turnoverTaxRegistered === 1,
    tpin: row.tpin ?? undefined,
    providers: JSON.parse(row.providersJson) as string[],
    onboardingCompleted: row.onboardingCompleted === 1,
  };
}

export interface OwnerRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  pinHash: string;
}

export async function getOwner(db: SQLiteDatabase): Promise<OwnerRecord | null> {
  const row = await db.getFirstAsync<OwnerRecord & { email: string | null }>(
    `SELECT id, name, phone, email, pin_hash AS pinHash
       FROM owner
      ORDER BY created_at ASC
      LIMIT 1`
  );
  return row ? { ...row, email: row.email ?? undefined } : null;
}

export interface CreateOwnerInput {
  /** The ID the server accepted; the phone and the backend share it. */
  id: string;
  name: string;
  phone: string;
  email?: string;
  pinHash: string;
}

/**
 * Caches an owner the server has already registered, so PIN sign-in works with
 * no connection afterwards. This is not an outbox write: the server is the
 * source of this row, not the phone.
 */
export async function createOwner(
  db: SQLiteDatabase,
  input: CreateOwnerInput
): Promise<OwnerRecord> {
  const existing = await getOwner(db);
  if (existing) throw new Error('An account already exists on this phone');

  const phoneClash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM owner WHERE phone = ?',
    input.phone
  );
  if (phoneClash) throw new Error('That phone number already has an account on this phone');

  const owner: OwnerRecord = {
    id: input.id,
    name: input.name.trim(),
    phone: input.phone,
    email: input.email?.trim().toLowerCase() || undefined,
    pinHash: input.pinHash,
  };
  const stamp = nowIso();

  await db.runAsync(
    `INSERT INTO owner (id, name, phone, email, pin_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    owner.id,
    owner.name,
    owner.phone,
    owner.email ?? null,
    owner.pinHash,
    stamp,
    stamp
  );

  return owner;
}

/**
 * An owner who signed in from another phone or recovered a forgotten PIN. The
 * server has just verified the email; replace the cached identity and its local
 * PIN hash instead of creating a second owner row.
 */
export async function upsertOwnerFromServer(
  db: SQLiteDatabase,
  input: CreateOwnerInput
): Promise<OwnerRecord> {
  const existing = await getOwner(db);
  const owner: OwnerRecord = {
    id: input.id,
    name: input.name.trim(),
    phone: input.phone,
    email: input.email?.trim().toLowerCase() || undefined,
    pinHash: input.pinHash,
  };

  if (existing) {
    if (existing.id !== owner.id) {
      throw new Error(
        'This phone already has a different owner account. Sign out and use a separate phone or wipe this one first.'
      );
    }

    const phoneClash = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM owner WHERE phone = ? AND id <> ?',
      owner.phone,
      owner.id
    );
    if (phoneClash) throw new Error('That phone number already has an account on this phone');

    await db.runAsync(
      `UPDATE owner
          SET name = ?, phone = ?, email = ?, pin_hash = ?, updated_at = ?
        WHERE id = ?`,
      owner.name,
      owner.phone,
      owner.email ?? null,
      owner.pinHash,
      nowIso(),
      existing.id
    );
    return owner;
  }

  const phoneClash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM staff WHERE phone = ?',
    owner.phone
  );
  if (phoneClash) throw new Error('That phone number belongs to a staff account on this phone');

  const stamp = nowIso();
  await db.runAsync(
    `INSERT INTO owner (id, name, phone, email, pin_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    owner.id,
    owner.name,
    owner.phone,
    owner.email ?? null,
    owner.pinHash,
    stamp,
    stamp
  );
  return owner;
}

/**
 * After a successful online PIN reset the phone must store the same new hash,
 * so the next sign-in can be checked offline. The server remains the source.
 */
export async function updateOwnerPinHash(
  db: SQLiteDatabase,
  ownerId: string,
  pinHash: string
): Promise<void> {
  const result = await db.runAsync(
    'UPDATE owner SET pin_hash = ?, updated_at = ? WHERE id = ?',
    pinHash,
    nowIso(),
    ownerId
  );
  if (result.changes === 0) throw new Error('Could not update the PIN on this phone');
}

export interface StaffRecord {
  id: string;
  name: string;
  phone: string;
  pinHash: string;
  role: 'staff';
  firstSignedInAt?: string;
}

export interface IdentityRecord {
  id: string;
  name: string;
  phone: string;
  pinHash: string;
  role: Role;
  firstSignedInAt?: string;
  createdAt: string;
}

export async function listStaff(db: SQLiteDatabase): Promise<StaffRecord[]> {
  const rows = await db.getAllAsync<StaffRecord & { firstSignedInAt: string | null }>(
    `SELECT id, name, phone, pin_hash AS pinHash, role,
            first_signed_in_at AS firstSignedInAt
       FROM staff
      ORDER BY created_at ASC`
  );
  return rows.map((row) => ({
    ...row,
    firstSignedInAt: row.firstSignedInAt ?? undefined,
  }));
}

/**
 * Everyone who can unlock this phone, in the order they were added. Sign-in
 * tries each PIN, so the owner and staff never need to choose a name first.
 */
export async function listIdentities(db: SQLiteDatabase): Promise<IdentityRecord[]> {
  const rows = await db.getAllAsync<IdentityRecord & { firstSignedInAt: string | null }>(
    `SELECT id, name, phone, pinHash, role, firstSignedInAt, createdAt
       FROM (
         SELECT id, name, phone, pin_hash AS pinHash, 'owner' AS role, NULL AS firstSignedInAt,
                created_at AS createdAt, 0 AS roleOrder
           FROM owner
          UNION ALL
         SELECT id, name, phone, pin_hash AS pinHash, 'staff' AS role, first_signed_in_at AS firstSignedInAt,
                created_at AS createdAt, 1 AS roleOrder
           FROM staff
       )
      ORDER BY roleOrder ASC, createdAt ASC`
  );
  return rows.map((row) => ({
    ...row,
    firstSignedInAt: row.firstSignedInAt ?? undefined,
  }));
}

export interface CreateStaffInput {
  /** The ID the server accepted; the phone and the backend share it. */
  id: string;
  name: string;
  phone: string;
  pinHash: string;
}

/**
 * Caches a staff member the server has already registered under this owner.
 * Like the owner row, this is server-sourced identity, not an outbox write, so
 * it must never be queued for sync.
 */
export async function createStaff(
  db: SQLiteDatabase,
  input: CreateStaffInput
): Promise<StaffRecord> {
  const name = input.name.trim();
  if (!name) throw new Error("Enter the staff member's name");
  const phone = normalisePhone(input.phone);
  if (!isValidPhone(phone)) throw new Error('Enter a phone number like 097 123 4567');

  const idClash =
    (await db.getFirstAsync<{ id: string }>('SELECT id FROM staff WHERE id = ?', input.id)) ??
    (await db.getFirstAsync<{ id: string }>('SELECT id FROM owner WHERE id = ?', input.id));
  if (idClash) throw new Error('That account ID is already used on this phone');

  const ownerPhoneClash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM owner WHERE phone = ?',
    phone
  );
  if (ownerPhoneClash) throw new Error('That phone number belongs to the owner');

  const staffPhoneClash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM staff WHERE phone = ?',
    phone
  );
  if (staffPhoneClash) throw new Error('That phone number already has a staff account on this phone');

  const stamp = nowIso();
  await db.runAsync(
    `INSERT INTO staff (id, name, phone, pin_hash, role, first_signed_in_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'staff', NULL, ?, ?)`,
    input.id,
    name,
    phone,
    input.pinHash,
    stamp,
    stamp
  );

  return { id: input.id, name, phone, pinHash: input.pinHash, role: 'staff' };
}

/**
 * A staff member signing in on a phone that does not have their row yet. The
 * server has just verified the PIN; this caches the same identity so the next
 * sign-in can be checked offline.
 */
export async function upsertStaffFromServer(
  db: SQLiteDatabase,
  input: CreateStaffInput
): Promise<StaffRecord> {
  const phone = normalisePhone(input.phone);
  if (!isValidPhone(phone)) throw new Error('The server returned an invalid phone number');

  const ownerClash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM owner WHERE phone = ?',
    phone
  );
  if (ownerClash) throw new Error('That phone number belongs to the owner');

  const byPhone = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM staff WHERE phone = ?',
    phone
  );
  if (byPhone && byPhone.id !== input.id) {
    throw new Error('That phone number already has a staff account on this phone');
  }

  const existing = await db.getFirstAsync<{ firstSignedInAt: string | null }>(
    'SELECT first_signed_in_at AS firstSignedInAt FROM staff WHERE id = ?',
    input.id
  );
  const stamp = nowIso();

  if (existing) {
    await db.runAsync(
      `UPDATE staff
          SET name = ?, phone = ?, pin_hash = ?, updated_at = ?
        WHERE id = ?`,
      input.name.trim(),
      phone,
      input.pinHash,
      stamp,
      input.id
    );
  } else {
    await db.runAsync(
      `INSERT INTO staff (id, name, phone, pin_hash, role, first_signed_in_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'staff', NULL, ?, ?)`,
      input.id,
      input.name.trim(),
      phone,
      input.pinHash,
      stamp,
      stamp
    );
  }

  return {
    id: input.id,
    name: input.name.trim(),
    phone,
    pinHash: input.pinHash,
    role: 'staff',
    firstSignedInAt: existing?.firstSignedInAt ?? undefined,
  };
}

/** Records the online first check so later staff sign-ins work offline. */
export async function markStaffFirstSignIn(
  db: SQLiteDatabase,
  staffId: string,
  at: string = nowIso()
): Promise<void> {
  const result = await db.runAsync(
    'UPDATE staff SET first_signed_in_at = COALESCE(first_signed_in_at, ?), updated_at = ? WHERE id = ?',
    at,
    at,
    staffId
  );
  if (result.changes === 0) throw new Error('Staff member not found on this phone');
}

export interface OnboardingState {
  hasShop: boolean;
  onboardingComplete: boolean;
  hasProducts: boolean;
}

export async function getOnboardingState(db: SQLiteDatabase): Promise<OnboardingState> {
  const shop = await db.getFirstAsync<{ onboardingCompleted: number }>(
    'SELECT onboarding_completed AS onboardingCompleted FROM shop LIMIT 1'
  );
  const products = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM product');
  return {
    hasShop: Boolean(shop),
    onboardingComplete: shop?.onboardingCompleted === 1,
    hasProducts: (products?.count ?? 0) > 0,
  };
}

export interface ShopDetailsInput {
  name: string;
  type: ShopType;
  town: string;
  language: 'en' | 'ny';
  usesBarcodes: boolean;
}

/**
 * Step 1 of onboarding. The first save creates the shop row; a later edit (from
 * Settings, or a resumed onboarding) updates the same row.
 */
export async function saveShopDetails(
  db: SQLiteDatabase,
  input: ShopDetailsInput
): Promise<string> {
  const name = input.name.trim();
  const town = input.town.trim();
  if (!name) throw new Error('Shop name is required');
  if (!town) throw new Error('Town is required');

  const current = await db.getFirstAsync<{ id: string; lowStockDefault: number }>(
    'SELECT id, low_stock_default AS lowStockDefault FROM shop LIMIT 1'
  );
  const shopId = current?.id ?? newId('shop');
  const stamp = nowIso();

  await db.withTransactionAsync(async () => {
    if (current) {
      await db.runAsync(
        `UPDATE shop
            SET name = ?, type = ?, town = ?, language = ?, uses_barcodes = ?, updated_at = ?
          WHERE id = ?`,
        name,
        input.type,
        town,
        input.language,
        input.usesBarcodes ? 1 : 0,
        stamp,
        shopId
      );
    } else {
      await db.runAsync(
        `INSERT INTO shop (id, name, type, town, currency, language, uses_barcodes, low_stock_default,
           turnover_tax_registered, tpin, providers_json, onboarding_completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ZMW', ?, ?, 3, 0, NULL, '[]', 0, ?, ?)`,
        shopId,
        name,
        input.type,
        town,
        input.language,
        input.usesBarcodes ? 1 : 0,
        stamp,
        stamp
      );
    }

    await enqueueSync(db, 'shop', shopId, current ? 'update' : 'create', {
      id: shopId,
      name,
      type: input.type,
      town,
      currency: 'ZMW',
      language: input.language,
      usesBarcodes: input.usesBarcodes,
      lowStockDefault: current?.lowStockDefault ?? 3,
      ...(current
        ? {}
        : { providers: [], turnoverTaxRegistered: false, tpin: null, createdAt: stamp }),
      updatedAt: stamp,
    });
  });

  return shopId;
}

export interface MoneySettingsInput {
  providers: string[];
  turnoverTaxRegistered: boolean;
  tpin?: string;
}

const PROVIDERS = ['MTN', 'Airtel', 'Zamtel'] as const;

/** Step 2 of onboarding: which payments the shop receives, and its tax status. */
export async function saveMoneySettings(
  db: SQLiteDatabase,
  input: MoneySettingsInput
): Promise<void> {
  const shop = await db.getFirstAsync<{ id: string }>('SELECT id FROM shop LIMIT 1');
  if (!shop) throw new Error('Complete the shop details first');

  const providers = [...new Set(input.providers)].filter((provider) =>
    PROVIDERS.includes(provider as (typeof PROVIDERS)[number])
  );
  const tpin = input.tpin?.trim() || null;
  if (tpin && !/^\d{10}$/.test(tpin)) {
    throw new Error('TPIN should be 10 digits, or left blank');
  }

  const stamp = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE shop
          SET providers_json = ?, turnover_tax_registered = ?, tpin = ?, updated_at = ?
        WHERE id = ?`,
      JSON.stringify(providers),
      input.turnoverTaxRegistered ? 1 : 0,
      tpin,
      stamp,
      shop.id
    );
    await enqueueSync(db, 'shop', shop.id, 'update', {
      id: shop.id,
      providers,
      turnoverTaxRegistered: input.turnoverTaxRegistered,
      tpin,
      updatedAt: stamp,
    });
  });
}

/**
 * The first tax period, so Tax and TaxPot have a due date from day one. The
 * demo seed used to provide this; onboarding now creates it. It uses the
 * current calendar month while the rules file still carries placeholder values.
 */
export async function ensureTaxPeriod(
  db: SQLiteDatabase,
  rules: TaxRules,
  today: string = todayLocal()
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM tax_period WHERE ? BETWEEN starts_on AND ends_on LIMIT 1',
    today
  );
  if (existing) return;

  const { startsOn, endsOn, dueOn } = taxPeriodForMonth(today, rules);
  const id = newId('tax');
  const stamp = nowIso();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO tax_period (id, starts_on, ends_on, turnover, rate_used, estimated_tax, due_on, paid,
         created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 0, ?, 0, ?, ?)`,
      id,
      startsOn,
      endsOn,
      rules.rate,
      dueOn,
      stamp,
      stamp
    );
    await enqueueSync(db, 'tax_period', id, 'create', {
      id,
      startsOn,
      endsOn,
      turnover: 0,
      rateUsed: rules.rate,
      estimatedTax: 0,
      dueOn,
      paid: false,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
}

/**
 * Step 3 is skippable, but the finish still needs to be recorded. This flag is
 * phone-only UI state, so it does not go into the sync queue.
 */
export async function completeOnboarding(db: SQLiteDatabase): Promise<void> {
  const shop = await db.getFirstAsync<{ id: string }>('SELECT id FROM shop LIMIT 1');
  if (!shop) throw new Error('Complete the shop details first');

  await db.runAsync(
    'UPDATE shop SET onboarding_completed = 1, updated_at = ? WHERE id = ?',
    nowIso(),
    shop.id
  );
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
  recordedByName: string;
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
    recordedByName: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    status: 'active' | 'void';
    voidReason: string | null;
    reconcileStatus: string;
  }>(
    `SELECT s.id, s.created_at AS createdAt,
            COALESCE(o.name, st.name, s.recorded_by) AS recordedByName,
            s.subtotal, s.discount_total AS discountTotal, s.total,
            s.status, s.void_reason AS voidReason, s.reconcile_status AS reconcileStatus
       FROM sale s
       LEFT JOIN owner o ON o.id = s.recorded_by
       LEFT JOIN staff st ON st.id = s.recorded_by
      WHERE s.id = ?`,
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
    recordedByName: sale.recordedByName,
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
  /** Active sales in this period that the owner has not reconciled yet. */
  unresolvedSales: number;
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
  if (!period) return { turnover: 0, potBalance: 0, period: null, unresolvedSales: 0 };

  const [start] = localDayBounds(period.startsOn);
  const [, end] = localDayBounds(period.endsOn);
  const row = await db.getFirstAsync<{
    turnover: number;
    potBalance: number;
    unresolvedSales: number;
  }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sale WHERE status = 'active' AND ${inRange('created_at')}), 0) AS turnover,
       COALESCE((SELECT COUNT(*) FROM sale
                  WHERE status = 'active'
                    AND reconcile_status <> 'matched'
                    -- Cash-only sales have nothing to reconcile against a message.
                    AND EXISTS (SELECT 1 FROM payment p
                                 WHERE p.sale_id = sale.id AND p.method = 'mobile_money')
                    AND ${inRange('created_at')}), 0) AS unresolvedSales,
       COALESCE((SELECT SUM(CASE WHEN kind = 'paid' THEN -amount ELSE amount END)
                   FROM tax_pot_entry
                  WHERE period_id = ?), 0) AS potBalance`,
    start,
    end,
    start,
    end,
    period.id
  );
  return {
    turnover: row?.turnover ?? 0,
    potBalance: row?.potBalance ?? 0,
    period,
    unresolvedSales: row?.unresolvedSales ?? 0,
  };
}

export interface TaxPotEntryRow {
  id: string;
  amount: Ngwee;
  kind: string;
  createdAt: string;
  saleId?: string;
}

export interface TaxPotView extends TaxSnapshot {
  entries: TaxPotEntryRow[];
}

export async function listTaxPotEntries(
  db: SQLiteDatabase,
  periodId: string
): Promise<TaxPotEntryRow[]> {
  return db.getAllAsync<TaxPotEntryRow>(
    `SELECT id, amount, kind, created_at AS createdAt, sale_id AS saleId
       FROM tax_pot_entry
      WHERE period_id = ?
      ORDER BY created_at DESC, id DESC`,
    periodId
  );
}

export async function getTaxPotView(
  db: SQLiteDatabase,
  today: string = todayLocal()
): Promise<TaxPotView> {
  const snapshot = await taxSnapshot(db, today);
  const entries = snapshot.period ? await listTaxPotEntries(db, snapshot.period.id) : [];
  return { ...snapshot, entries };
}

/** Money the owner sets aside by hand. The app never moves real money. */
export async function topUpTaxPot(
  db: SQLiteDatabase,
  periodId: string,
  amount: Ngwee
): Promise<void> {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new Error('Amount must be a whole number of ngwee');
  }
  if (amount <= 0) throw new Error('Amount must be greater than zero');

  const stamp = nowIso();
  const entryId = newId('pot');
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO tax_pot_entry (id, amount, kind, period_id, created_at, updated_at)
       VALUES (?, ?, 'top_up', ?, ?, ?)`,
      entryId,
      amount,
      periodId,
      stamp,
      stamp
    );
    await enqueueSync(db, 'tax_pot_entry', entryId, 'create', {
      id: entryId,
      periodId,
      amount,
      kind: 'top_up',
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
}

/**
 * Simulated ZRA payment. The full balance is marked paid with a negative entry,
 * which zeroes the pot without deleting history, and the period is flagged paid
 * so the due-date nag stops.
 */
export async function payTaxPot(
  db: SQLiteDatabase,
  periodId: string
): Promise<{ amount: Ngwee; paidAt: string }> {
  const stamp = nowIso();
  const entryId = newId('pot');
  let balance = 0;
  // The balance is read inside the transaction, so two overlapping payments
  // cannot both pay the same money.
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ balance: number }>(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'paid' THEN -amount ELSE amount END), 0) AS balance
         FROM tax_pot_entry WHERE period_id = ?`,
      periodId
    );
    balance = row?.balance ?? 0;
    if (balance <= 0) throw new Error('There is nothing set aside to pay');

    await db.runAsync(
      `INSERT INTO tax_pot_entry (id, amount, kind, period_id, created_at, updated_at)
       VALUES (?, ?, 'paid', ?, ?, ?)`,
      entryId,
      balance,
      periodId,
      stamp,
      stamp
    );
    await enqueueSync(db, 'tax_pot_entry', entryId, 'create', {
      id: entryId,
      periodId,
      amount: balance,
      kind: 'paid',
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.runAsync('UPDATE tax_period SET paid = 1, updated_at = ? WHERE id = ?', stamp, periodId);
    await enqueueSync(db, 'tax_period', periodId, 'update', {
      id: periodId,
      paid: true,
      amountPaid: balance,
      paidAt: stamp,
    });
  });

  return { amount: balance, paidAt: stamp };
}

/** Cash at closing is upserted per day, with expected cash derived, not typed. */
export async function saveCashCount(
  db: SQLiteDatabase,
  day: string,
  countedCash: Ngwee,
  note?: string,
  overwrite = false
): Promise<{ expected: Ngwee; variance: Ngwee }> {
  const [start, end] = localDayBounds(day);
  const cash = await db.getFirstAsync<{
    cashSales: number;
    openingFloat: number | null;
    countedCash: number | null;
  }>(
    `SELECT
       COALESCE((SELECT SUM(p.amount)
                   FROM payment p
                   JOIN sale s ON s.id = p.sale_id
                  WHERE p.method = 'cash' AND s.status = 'active' AND ${inRange('s.created_at')}), 0) AS cashSales,
       (SELECT opening_float FROM reconciliation WHERE day = ?) AS openingFloat,
       (SELECT counted_cash FROM reconciliation WHERE day = ?) AS countedCash`,
    start,
    end,
    day,
    day
  );

  if (!overwrite && cash?.countedCash !== null && cash?.countedCash !== undefined) {
    throw new Error('A cash count for today has already been saved');
  }

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

export interface ReconciledMatch {
  saleId: string;
  paymentId: string;
  txnId: string;
  amount: Ngwee;
  reference?: string;
  at: string;
}

export interface SaleWithoutPayment {
  saleId: string;
  total: Ngwee;
  createdAt: string;
  provider?: string;
  reference?: string;
}

export interface PaymentWithoutSale {
  txnId: string;
  provider: string;
  amount: Ngwee;
  sender?: string;
  reference?: string;
  receivedAt: string;
}

export interface ReconcileCash {
  openingFloat: Ngwee;
  expected: Ngwee;
  countedCash?: Ngwee;
  variance?: Ngwee;
  note?: string;
}

export interface ReconcileDayResult {
  day: string;
  matched: ReconciledMatch[];
  salesWithoutPayment: SaleWithoutPayment[];
  /** More than one payment fits: the owner must choose. */
  needsReview: SaleWithoutPayment[];
  paymentsWithoutSale: PaymentWithoutSale[];
  cash: ReconcileCash;
}

/**
 * Runs the matching engine over one day and persists the outcome, so the Sales
 * tab and the Tax screen can trust `sale.reconcile_status` without recomputing.
 *
 * The rule is in docs/reconciliation-rule.md. Two details live here:
 * - Payments the owner confirmed by hand are settled and never re-matched.
 * - Sales and messages within the window either side of the day are included
 *   while still open, so a payment just after midnight still finds its sale.
 *   Their status is only written when they match; otherwise their own day owns it.
 */
export async function reconcileDay(
  db: SQLiteDatabase,
  day: string = todayLocal(),
  windowMinutes = 30
): Promise<ReconcileDayResult> {
  const [start, end] = localDayBounds(day);
  const marginMs = windowMinutes * 60_000;
  const outerStart = new Date(new Date(start).getTime() - marginMs).toISOString();
  const outerEnd = new Date(new Date(end).getTime() + marginMs).toISOString();

  const payments = await db.getAllAsync<{
    paymentId: string;
    saleId: string;
    amount: number;
    reference: string | null;
    provider: string | null;
    createdAt: string;
    confirmedAt: string | null;
    matchedTxnId: string | null;
    saleStatus: string;
    inDay: number;
  }>(
    `SELECT p.id AS paymentId, p.sale_id AS saleId, p.amount,
            p.mobile_money_reference AS reference, p.provider, s.created_at AS createdAt,
            p.confirmed_at AS confirmedAt, p.matched_txn_id AS matchedTxnId,
            s.reconcile_status AS saleStatus,
            (${inRange('s.created_at')}) AS inDay
       FROM payment p
       JOIN sale s ON s.id = p.sale_id
      WHERE p.method = 'mobile_money'
        AND s.status = 'active'
        AND ${inRange('s.created_at')}
        AND ((${inRange('s.created_at')}) OR s.reconcile_status <> 'matched')`,
    start,
    end,
    outerStart,
    outerEnd,
    start,
    end
  );

  const txns = await db.getAllAsync<{
    id: string;
    provider: string;
    amount: number;
    sender: string | null;
    reference: string | null;
    receivedAt: string;
    status: string;
    inDay: number;
    settled: number;
  }>(
    `SELECT id, provider, amount, sender, reference, received_at AS receivedAt, status,
            (${inRange('received_at')}) AS inDay,
            EXISTS (SELECT 1 FROM payment p JOIN sale s ON s.id = p.sale_id
                     WHERE p.matched_txn_id = mobile_money_txn.id AND s.status = 'active') AS settled
       FROM mobile_money_txn
      WHERE status <> 'ignored'
        AND ${inRange('received_at')}
        AND ((${inRange('received_at')}) OR status = 'unmatched')`,
    start,
    end,
    outerStart,
    outerEnd,
    start,
    end
  );

  // Payments confirmed by hand or paired by an earlier run are settled, and so
  // are messages paired to an active sale. Only the rest go to the matcher, so
  // a run that cannot see a pair's other half never undoes it.
  const open = payments.filter((payment) => !payment.confirmedAt && !payment.matchedTxnId);
  const openTxns = txns.filter((txn) => txn.settled !== 1);

  const result = matchPayments(
    open.map((payment) => ({
      id: payment.paymentId,
      amount: payment.amount,
      reference: payment.reference ?? undefined,
      provider: payment.provider ?? undefined,
      at: payment.createdAt,
    })),
    openTxns.map((txn) => ({
      id: txn.id,
      amount: txn.amount,
      reference: txn.reference ?? undefined,
      provider: txn.provider,
      at: txn.receivedAt,
    })),
    windowMinutes
  );

  // matchPayments calls its first argument "sales"; here those are payment ids.
  const newPairs = new Map(result.matched.map((match) => [match.saleId, match.receivedId]));
  const txnByPaymentId = new Map(newPairs);
  for (const payment of payments) {
    if (payment.matchedTxnId) txnByPaymentId.set(payment.paymentId, payment.matchedTxnId);
  }
  const matchedTxnIds = new Set([
    ...newPairs.values(),
    ...txns.filter((txn) => txn.settled === 1).map((txn) => txn.id),
  ]);
  const ambiguousPaymentIds = new Set(result.ambiguousSales);
  const stamp = nowIso();

  const cashRow = await db.getFirstAsync<{ cashSales: number }>(
    `SELECT COALESCE(SUM(p.amount), 0) AS cashSales
       FROM payment p
       JOIN sale s ON s.id = p.sale_id
      WHERE p.method = 'cash'
        AND s.status = 'active'
        AND ${inRange('s.created_at')}`,
    start,
    end
  );

  const existing = await db.getFirstAsync<{
    openingFloat: number;
    countedCash: number | null;
    note: string | null;
  }>(
    `SELECT opening_float AS openingFloat, counted_cash AS countedCash, note
       FROM reconciliation WHERE day = ?`,
    day
  );

  const openingFloat = existing?.openingFloat ?? 0;
  const countedCash = existing?.countedCash ?? undefined;
  // Expected cash comes from the same helper the UI uses, so the two cannot drift.
  const cash = cashVariance(openingFloat, cashRow?.cashSales ?? 0, countedCash ?? 0);

  const isMatched = (payment: (typeof payments)[number]) =>
    Boolean(payment.confirmedAt) || txnByPaymentId.has(payment.paymentId);
  const inDayPayments = payments.filter((payment) => payment.inDay === 1);
  const matchedPayments = payments.filter(isMatched);
  const salesWithoutPayment = inDayPayments.filter(
    (payment) => !isMatched(payment) && !ambiguousPaymentIds.has(payment.paymentId)
  );
  const ambiguousSales = inDayPayments.filter((payment) => ambiguousPaymentIds.has(payment.paymentId));
  const paymentsWithoutSale = txns.filter((txn) => txn.inDay === 1 && !matchedTxnIds.has(txn.id));

  await db.withTransactionAsync(async () => {
    for (const [paymentId, txnId] of newPairs) {
      await db.runAsync('UPDATE payment SET matched_txn_id = ?, updated_at = ? WHERE id = ?', txnId, stamp, paymentId);
      await enqueueSync(db, 'payment', paymentId, 'update', { id: paymentId, matchedTxnId: txnId, updatedAt: stamp });
    }

    for (const payment of open) {
      const matched = newPairs.has(payment.paymentId);
      // A neighbouring day's sale is only touched when it matched here.
      if (!matched && payment.inDay !== 1) continue;
      const status = matched
        ? 'matched'
        : ambiguousPaymentIds.has(payment.paymentId)
          ? 'unresolved'
          : 'sale_no_payment';
      if (status === payment.saleStatus) continue;
      await db.runAsync('UPDATE sale SET reconcile_status = ?, updated_at = ? WHERE id = ?', status, stamp, payment.saleId);
      await enqueueSync(db, 'sale', payment.saleId, 'update', {
        sale: { id: payment.saleId, reconcileStatus: status, updatedAt: stamp },
      });
    }

    for (const txn of txns) {
      const matched = matchedTxnIds.has(txn.id);
      if (!matched && txn.inDay !== 1) continue;
      const status = matched ? 'matched' : 'unmatched';
      if (status === txn.status) continue;
      await db.runAsync('UPDATE mobile_money_txn SET status = ?, updated_at = ? WHERE id = ?', status, stamp, txn.id);
      await enqueueSync(db, 'mobile_money_txn', txn.id, 'update', { id: txn.id, status, updatedAt: stamp });
    }

    await db.runAsync(
      `INSERT INTO reconciliation (id, day, matched_count, sale_no_payment_count, payment_no_sale_count,
         opening_float, counted_cash, expected_cash, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         matched_count = excluded.matched_count,
         sale_no_payment_count = excluded.sale_no_payment_count,
         payment_no_sale_count = excluded.payment_no_sale_count,
         expected_cash = excluded.expected_cash,
         updated_at = excluded.updated_at`,
      newId('rec'),
      day,
      matchedPayments.length,
      salesWithoutPayment.length,
      paymentsWithoutSale.length,
      openingFloat,
      countedCash ?? null,
      cash.expected,
      existing?.note ?? null,
      stamp,
      stamp
    );
  });

  const toSaleRow = (payment: (typeof payments)[number]): SaleWithoutPayment => ({
    saleId: payment.saleId,
    total: payment.amount,
    createdAt: payment.createdAt,
    provider: payment.provider ?? undefined,
    reference: payment.reference ?? undefined,
  });

  return {
    day,
    matched: matchedPayments.map((payment) => ({
      saleId: payment.saleId,
      paymentId: payment.paymentId,
      // Empty for a sale the owner confirmed by hand: there is no message.
      txnId: txnByPaymentId.get(payment.paymentId) ?? '',
      amount: payment.amount,
      reference: payment.reference ?? undefined,
      at: payment.createdAt,
    })),
    salesWithoutPayment: salesWithoutPayment.map(toSaleRow),
    needsReview: ambiguousSales.map(toSaleRow),
    paymentsWithoutSale: paymentsWithoutSale.map((txn) => ({
      txnId: txn.id,
      provider: txn.provider,
      amount: txn.amount,
      sender: txn.sender ?? undefined,
      reference: txn.reference ?? undefined,
      receivedAt: txn.receivedAt,
    })),
    cash: {
      openingFloat,
      expected: cash.expected,
      countedCash,
      variance: countedCash === undefined ? undefined : cash.variance,
      note: existing?.note ?? undefined,
    },
  };
}

/**
 * The owner says the money did arrive. That confirms the sale's own mobile
 * money payment rather than adding a second one, so the sale is not paid twice
 * and the matcher leaves it alone from then on.
 */
export async function markSalePaid(db: SQLiteDatabase, saleId: string): Promise<void> {
  const stamp = nowIso();
  await db.withTransactionAsync(async () => {
    const open = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM payment
        WHERE sale_id = ? AND method = 'mobile_money' AND confirmed_at IS NULL`,
      saleId
    );
    if (open.length === 0) throw new Error('This sale has no mobile money payment waiting');

    for (const payment of open) {
      await db.runAsync('UPDATE payment SET confirmed_at = ?, updated_at = ? WHERE id = ?', stamp, stamp, payment.id);
      await enqueueSync(db, 'payment', payment.id, 'update', {
        id: payment.id,
        confirmedAt: stamp,
        updatedAt: stamp,
      });
    }
    await db.runAsync("UPDATE sale SET reconcile_status = 'matched', updated_at = ? WHERE id = ?", stamp, saleId);
    await enqueueSync(db, 'sale', saleId, 'update', {
      sale: { id: saleId, reconcileStatus: 'matched', updatedAt: stamp },
    });
  });
}

/** A payment that was not a sale at all: dismissed, kept for the audit trail. */
export async function ignorePayment(db: SQLiteDatabase, txnId: string): Promise<void> {
  const stamp = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE mobile_money_txn SET status = 'ignored', updated_at = ? WHERE id = ?", stamp, txnId);
    await enqueueSync(db, 'mobile_money_txn', txnId, 'update', { id: txnId, status: 'ignored', updatedAt: stamp });
  });
}

/**
 * Demo helper (#20). Real provider messages cannot be triggered on cue, so this
 * fabricates the two messages the demo needs: one that matches the newest
 * unreconciled mobile money sale, and one that belongs to no sale.
 *
 * References are optional at the counter, so the matching message copies the
 * sale's reference when it has one and carries none when it doesn't, which is
 * exactly what the matcher pairs.
 */
export async function injectDemoMessages(
  db: SQLiteDatabase,
  day: string = todayLocal()
): Promise<{ matched: number; orphan: number }> {
  const [start, end] = localDayBounds(day);
  const stamp = nowIso();

  const pending = await db.getFirstAsync<{
    amount: number;
    reference: string | null;
    provider: 'MTN' | 'Airtel' | 'Zamtel';
  }>(
    `SELECT p.amount, p.mobile_money_reference AS reference, p.provider
       FROM payment p
       JOIN sale s ON s.id = p.sale_id
      WHERE p.method = 'mobile_money'
        AND p.confirmed_at IS NULL
        AND s.status = 'active'
        AND s.reconcile_status <> 'matched'
        AND ${inRange('s.created_at')}
        AND NOT EXISTS (
          SELECT 1 FROM mobile_money_txn t
           WHERE t.status <> 'ignored'
             AND (t.reference = p.mobile_money_reference
                  OR (p.mobile_money_reference IS NULL AND t.reference IS NULL
                      AND t.amount = p.amount AND t.provider = p.provider))
        )
      ORDER BY s.created_at DESC
      LIMIT 1`,
    start,
    end
  );

  let matched = 0;
  if (pending) {
    const refText = pending.reference ? ` Ref ${pending.reference}.` : '';
    await db.runAsync(
      `INSERT INTO mobile_money_txn (id, provider, amount, sender, reference, received_at, raw_message, parsed, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'unmatched', ?, ?)`,
      newId('mm'),
      pending.provider,
      pending.amount,
      'Demo customer',
      pending.reference,
      stamp,
      `You have received K${(pending.amount / 100).toFixed(2)}.${refText}`,
      stamp,
      stamp
    );
    matched = 1;
  }

  const orphan = await db.getFirstAsync<{ id: string }>(
    `SELECT t.id
       FROM mobile_money_txn t
      WHERE t.status = 'unmatched'
        AND t.reference LIKE 'ZAM-DEMO-%'
        AND ${inRange('t.received_at')}
      LIMIT 1`,
    start,
    end
  );

  let orphanCreated = 0;
  if (!orphan) {
    const reference = `ZAM-DEMO-${Date.now().toString(36).toUpperCase()}`;
    await db.runAsync(
      `INSERT INTO mobile_money_txn (id, provider, amount, sender, reference, received_at, raw_message, parsed, status, created_at, updated_at)
       VALUES (?, 'Zamtel', 45000, 'Grace Phiri', ?, ?, ?, 1, 'unmatched', ?, ?)`,
      newId('mm'),
      reference,
      stamp,
      `Zamtel Money: You have received K450.00 from Grace Phiri. Transaction ID ${reference}.`,
      stamp,
      stamp
    );
    orphanCreated = 1;
  }

  return { matched, orphan: orphanCreated };
}
