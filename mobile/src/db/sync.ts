import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, nowIso } from '@/core';
import { pullSync, pushSync, type SyncPullChange } from '@/lib/api';

/**
 * The outbox runner. It sends the local `sync_queue` in one batch and applies
 * the server's pull cursor in order. Every local row is written with the id the
 * phone generated, so replaying a batch is a no-op.
 */

type JsonRecord = Record<string, unknown>;

type QueueRow = {
  id: string;
  entity: string;
  entity_id: string;
  operation: 'create' | 'update';
  payload: string;
  attempts: number;
  created_at: string;
};

export type SyncStatus = {
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type SyncRunResult = {
  pushed: number;
  rejected: number;
  applied: number;
  pending: number;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((row) => Object.keys(row).length > 0) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function integer(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return undefined;
}

function bool(value: unknown): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 0 || value === 1) return value;
  return undefined;
}

function json(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function defined(values: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

/** The one shop this phone holds, sent with every sync so rows can never land in another. */
async function localShopId(db: SQLiteDatabase): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM shop LIMIT 1');
  return row?.id;
}

/**
 * Which owner's shop this phone belongs to. The owner row says so when the
 * owner has signed in here; a staff-only phone remembers the owner of the
 * first staff member who signed in, so staff of another shop are refused.
 */
export async function shopOwnerId(db: SQLiteDatabase): Promise<string | null> {
  const owner = await db.getFirstAsync<{ id: string }>('SELECT id FROM owner LIMIT 1');
  return owner?.id ?? (await getMeta(db, 'shopOwnerId'));
}

export async function rememberShopOwnerId(db: SQLiteDatabase, ownerId: string): Promise<void> {
  await setMeta(db, 'shopOwnerId', ownerId);
}

/** Merge the provided columns into an existing row, or insert a new one. */
async function upsert(
  db: SQLiteDatabase,
  table: string,
  values: JsonRecord
): Promise<void> {
  const clean = defined(values);
  if (!clean.id) return;
  const existing = await db.getFirstAsync<JsonRecord>(
    `SELECT * FROM ${table} WHERE id = ?`,
    clean.id as string
  );
  const merged = { ...(existing ?? {}), ...clean };
  const columns = Object.keys(merged);
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    ...columns.map((column) => merged[column] as string | number | null)
  );
}

function mapShop(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    name: text(p.name),
    type: text(p.type),
    town: text(p.town),
    currency: text(p.currency),
    language: text(p.language),
    uses_barcodes: bool(p.usesBarcodes),
    low_stock_default: integer(p.lowStockDefault),
    turnover_tax_registered: bool(p.turnoverTaxRegistered),
    tpin: text(p.tpin),
    // The phone has always sent this as `providers`; `providersJson` is the older spelling.
    providers_json: json(p.providersJson ?? p.providers),
    onboarding_completed: bool(p.onboardingCompleted),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapProduct(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    name: text(p.name),
    category: text(p.category),
    photo_uri: text(p.photoUri),
    default_buy_price: integer(p.defaultBuyPrice),
    default_sell_price: integer(p.defaultSellPrice),
    discount_json: json(p.discountJson),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapVariant(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    product_id: text(p.productId),
    size: text(p.size),
    colour: text(p.colour) ?? text(p.color),
    barcode: text(p.barcode),
    buy_price: integer(p.buyPrice),
    sell_price: integer(p.sellPrice),
    low_stock_level: integer(p.lowStockLevel),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapSale(p: JsonRecord, fallbackId: string): JsonRecord {
  return {
    id: text(p.id) ?? fallbackId,
    recorded_by: text(p.recordedBy),
    subtotal: integer(p.subtotal),
    discount_total: integer(p.discountTotal),
    total: integer(p.total),
    status: text(p.status),
    void_reason: text(p.voidReason),
    reconcile_status: text(p.reconcileStatus),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapLine(p: JsonRecord, saleId: string): JsonRecord {
  return {
    id: text(p.id),
    sale_id: text(p.saleId) ?? saleId,
    variant_id: text(p.variantId),
    quantity: integer(p.quantity),
    buy_price: integer(p.buyPrice),
    list_price: integer(p.listPrice),
    discount: integer(p.discount),
    final_price: integer(p.finalPrice),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapPayment(p: JsonRecord, fallbackSale?: string): JsonRecord {
  return {
    id: text(p.id),
    sale_id: text(p.saleId) ?? fallbackSale,
    method: text(p.method),
    provider: text(p.provider),
    amount: integer(p.amount),
    mobile_money_reference: text(p.mobileMoneyReference),
    confirmed_at: text(p.confirmedAt),
    matched_txn_id: text(p.matchedTxnId),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapSmartInvoiceReceipt(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    sale_id: text(p.saleId),
    receipt_type: text(p.receiptType),
    invoice_no: integer(p.invoiceNo),
    original_invoice_no: integer(p.originalInvoiceNo),
    result_code: text(p.resultCode),
    result_message: text(p.resultMessage),
    receipt_no: integer(p.receiptNo),
    receipt_signature: text(p.receiptSignature),
    internal_data: text(p.internalData),
    sdc_id: text(p.sdcId),
    mrc_no: text(p.mrcNo),
    published_at: text(p.publishedAt),
    simulated: p.simulated === false ? 0 : 1,
  };
}

function mapTxn(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    provider: text(p.provider),
    amount: integer(p.amount),
    sender: text(p.sender),
    reference: text(p.reference),
    received_at: text(p.receivedAt),
    raw_message: text(p.rawMessage),
    parsed: bool(p.parsed),
    status: text(p.status),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapReconciliation(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    day: text(p.day),
    matched_count: integer(p.matchedCount),
    sale_no_payment_count: integer(p.saleNoPaymentCount),
    payment_no_sale_count: integer(p.paymentNoSaleCount),
    opening_float: integer(p.openingFloat),
    counted_cash: p.countedCash === null ? null : integer(p.countedCash),
    expected_cash: integer(p.expectedCash),
    note: text(p.note),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapTaxPeriod(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    starts_on: text(p.startsOn),
    ends_on: text(p.endsOn),
    turnover: integer(p.turnover),
    rate_used: typeof p.rateUsed === 'number' ? p.rateUsed : undefined,
    estimated_tax: integer(p.estimatedTax),
    due_on: text(p.dueOn),
    paid: bool(p.paid),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

function mapTaxPotEntry(p: JsonRecord): JsonRecord {
  return {
    id: text(p.id),
    amount: integer(p.amount),
    kind: text(p.kind),
    period_id: text(p.periodId),
    sale_id: text(p.saleId),
    created_at: text(p.createdAt),
    updated_at: text(p.updatedAt),
  };
}

async function insertMovement(
  db: SQLiteDatabase,
  p: JsonRecord,
  fallbackSale?: string
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO stock_movement
       (id, variant_id, quantity_change, reason, note, sale_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.id) ?? null,
    text(p.variantId) ?? null,
    integer(p.quantityChange) ?? null,
    text(p.reason) ?? null,
    text(p.note) ?? null,
    text(p.saleId) ?? fallbackSale ?? null,
    text(p.createdAt) ?? nowIso(),
    text(p.updatedAt) ?? nowIso()
  );
}

async function applySale(db: SQLiteDatabase, payload: JsonRecord, entityId: string): Promise<void> {
  const sale = record(payload.sale ?? payload);
  const saleId = text(sale.id) ?? entityId;
  await upsert(db, 'sale', mapSale(sale, saleId));
  for (const line of list(payload.lines)) {
    await upsert(db, 'sale_line', mapLine(line, saleId));
  }
  for (const payment of list(payload.payments)) {
    await upsert(db, 'payment', mapPayment(payment, saleId));
  }
  for (const movement of list(payload.stockMovements ?? payload.stock_movements)) {
    await insertMovement(db, movement, saleId);
  }
}

/** Apply one pulled change. Exported so the sync integration test can use it. */
export async function applyPulledChange(
  db: SQLiteDatabase,
  change: SyncPullChange
): Promise<void> {
  const payload = record(change.payload);
  switch (change.entity) {
    case 'shop':
      await upsert(db, 'shop', mapShop(payload));
      break;
    case 'product':
      await upsert(db, 'product', mapProduct(payload));
      break;
    case 'product_variant':
      await upsert(db, 'product_variant', mapVariant(payload));
      break;
    case 'stock_movement':
      await insertMovement(db, payload);
      break;
    case 'sale':
      await applySale(db, payload, change.entityId);
      break;
    case 'payment':
      await upsert(db, 'payment', mapPayment(payload));
      break;
    case 'mobile_money_txn':
      await upsert(db, 'mobile_money_txn', mapTxn(payload));
      break;
    case 'reconciliation':
      await upsert(db, 'reconciliation', mapReconciliation(payload));
      break;
    case 'tax_period':
      await upsert(db, 'tax_period', mapTaxPeriod(payload));
      break;
    case 'tax_pot_entry':
      await upsert(db, 'tax_pot_entry', mapTaxPotEntry(payload));
      break;
    case 'smart_invoice_receipt':
      await upsert(db, 'smart_invoice_receipt', mapSmartInvoiceReceipt(payload));
      break;
    default:
      throw new Error(`Unknown sync entity '${change.entity}'.`);
  }
}

export async function pendingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue');
  return row?.n ?? 0;
}

export async function syncStatus(db: SQLiteDatabase): Promise<SyncStatus> {
  const lastSyncAt = await getMeta(db, 'lastSyncAt');
  const failed = await db.getFirstAsync<{ last_error: string | null }>(
    `SELECT last_error FROM sync_queue
      WHERE last_error IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`
  );
  return {
    pending: await pendingCount(db),
    lastSyncAt,
    lastError: failed?.last_error ?? null,
  };
}

async function deviceId(db: SQLiteDatabase): Promise<string> {
  const existing = await getMeta(db, 'deviceId');
  if (existing) return existing;
  const id = newId('dev');
  await setMeta(db, 'deviceId', id);
  return id;
}

export async function pushOutbox(
  db: SQLiteDatabase,
  accessToken: string,
  limit = 100
): Promise<{ pushed: number; rejected: number; pending: number }> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT id, entity, entity_id, operation, payload, attempts, created_at
       FROM sync_queue ORDER BY created_at, id LIMIT ?`,
    limit
  );
  if (rows.length === 0) {
    return { pushed: 0, rejected: 0, pending: await pendingCount(db) };
  }

  const changes = rows.map((row) => ({
    queueId: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload) as unknown,
    clientCreatedAt: row.created_at,
    attempts: row.attempts,
  }));

  try {
    const result = await pushSync({
      deviceId: await deviceId(db),
      batchId: newId('batch'),
      changes,
      accessToken,
      shopId: await localShopId(db),
    });
    const accepted = new Set(result.accepted);
    const rejected = new Map(result.rejected.map((row) => [row.queueId, row.reason]));

    await db.withTransactionAsync(async () => {
      for (const row of rows) {
        if (accepted.has(row.id)) {
          await db.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
        } else {
          await db.runAsync(
            'UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?',
            rejected.get(row.id) ?? 'The server did not accept this change.',
            nowIso(),
            row.id
          );
        }
      }
      await setMeta(db, 'lastPushAt', nowIso());
    });

    return {
      pushed: accepted.size,
      rejected: rejected.size,
      pending: await pendingCount(db),
    };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Could not reach the sync service';
    await db.withTransactionAsync(async () => {
      for (const row of rows) {
        await db.runAsync(
          'UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?',
          reason,
          nowIso(),
          row.id
        );
      }
    });
    throw cause;
  }
}

export async function pullChanges(
  db: SQLiteDatabase,
  accessToken: string,
  limit = 500
): Promise<{ applied: number; nextCursor: string }> {
  const cursor = (await getMeta(db, 'cursor')) ?? '0';
  const result = await pullSync({ accessToken, cursor, limit, shopId: await localShopId(db) });

  await db.withTransactionAsync(async () => {
    for (const change of result.changes) {
      await applyPulledChange(db, change);
    }
    await setMeta(db, 'cursor', result.nextCursor);
    await setMeta(db, 'lastPullAt', nowIso());
  });

  return { applied: result.changes.length, nextCursor: result.nextCursor };
}

/**
 * A phone with no shop pulls everything the server holds for the account, page
 * by page, so a large shop comes back whole. Returns how many changes arrived.
 */
export async function restoreFromServer(
  db: SQLiteDatabase,
  accessToken: string,
  pageSize = 500
): Promise<number> {
  let total = 0;
  for (let page = 0; page < 200; page += 1) {
    const { applied } = await pullChanges(db, accessToken, pageSize);
    total += applied;
    if (applied < pageSize) break;
  }
  await setMeta(db, 'lastSyncAt', nowIso());
  return total;
}

async function runSync(db: SQLiteDatabase, accessToken: string): Promise<SyncRunResult> {
  const pushed = await pushOutbox(db, accessToken);
  const pulled = await pullChanges(db, accessToken);
  await setMeta(db, 'lastSyncAt', nowIso());
  return {
    pushed: pushed.pushed,
    rejected: pushed.rejected,
    applied: pulled.applied,
    pending: await pendingCount(db),
  };
}

let active: Promise<SyncRunResult> | null = null;

/** Push then pull. Concurrent callers share one run. */
export function syncNow(db: SQLiteDatabase, accessToken: string): Promise<SyncRunResult> {
  if (active) return active;
  active = runSync(db, accessToken).finally(() => {
    active = null;
  });
  return active;
}
