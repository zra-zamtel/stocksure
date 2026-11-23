import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueSync, getSmartInvoiceLink, listSmartInvoiceReceipts } from './repos';
import { applyPulledChange, pullChanges, pushOutbox } from './sync';
import { count, openTestDb, type TestDb } from '@/test/sqlite';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: '192.168.1.20:8081' } },
}));

const NOW = '2026-11-18T08:00:00Z';

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function echoAccepted() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      changes: { queueId: string }[];
    };
    return new Response(
      JSON.stringify({
        accepted: body.changes.map((change) => change.queueId),
        rejected: [],
        serverTime: NOW,
        cursor: '1',
      }),
      { status: 200 }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let db: TestDb;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});

describe('IT-SYNC outbox push', () => {
  it('uploads the queue, deletes accepted rows and records the sync time', async () => {
    await enqueueSync(db, 'shop', 'shop_1', 'create', { id: 'shop_1', name: 'Test Shop' });
    const fetchMock = echoAccepted();

    const result = await pushOutbox(db, 'jwt');

    expect(result).toEqual({ pushed: 1, rejected: 0, pending: 0 });
    expect(await count(db, 'sync_queue')).toBe(0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/sync/push');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    const body = JSON.parse(init.body as string);
    expect(body.changes[0]).toMatchObject({
      entity: 'shop',
      entityId: 'shop_1',
      operation: 'create',
      payload: { id: 'shop_1', name: 'Test Shop' },
    });
    const meta = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = 'lastPushAt'"
    );
    expect(meta?.value).toBeTruthy();
  });

  it('keeps rejected rows and stores the reason for the next attempt', async () => {
    await enqueueSync(db, 'product', 'prod_1', 'create', { id: 'prod_1' });
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM sync_queue');
    respond(200, {
      accepted: [],
      rejected: [{ queueId: row?.id, reason: 'productId does not exist' }],
      serverTime: NOW,
      cursor: '1',
    });

    const result = await pushOutbox(db, 'jwt');

    expect(result).toEqual({ pushed: 0, rejected: 1, pending: 1 });
    const queued = await db.getFirstAsync<{ attempts: number; last_error: string }>(
      'SELECT attempts, last_error FROM sync_queue'
    );
    expect(queued).toMatchObject({ attempts: 1, last_error: 'productId does not exist' });
  });
});

describe('IT-SYNC pull and apply', () => {
  it('applies a shop and advances the cursor', async () => {
    respond(200, {
      changes: [
        {
          entity: 'shop',
          entityId: 'shop_1',
          operation: 'create',
          payload: {
            id: 'shop_1',
            name: 'Pulled Shop',
            type: 'shoes',
            town: 'Kabwe',
            currency: 'ZMW',
            language: 'en',
            usesBarcodes: false,
            lowStockDefault: 3,
            turnoverTaxRegistered: false,
            providersJson: [],
            onboardingCompleted: true,
            createdAt: NOW,
            updatedAt: NOW,
          },
          cursor: '1',
          clientCreatedAt: NOW,
        },
      ],
      nextCursor: '1',
      serverTime: NOW,
    });

    const result = await pullChanges(db, 'jwt');

    expect(result).toEqual({ applied: 1, nextCursor: '1' });
    const shop = await db.getFirstAsync<{ name: string; onboarding_completed: number }>(
      'SELECT name, onboarding_completed FROM shop WHERE id = ?',
      'shop_1'
    );
    expect(shop).toEqual({ name: 'Pulled Shop', onboarding_completed: 1 });
    const meta = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = 'cursor'"
    );
    expect(meta?.value).toBe('1');
  });

  it('applies a sale with its lines, payment and stock movement', async () => {
    const shop = {
      id: 'shop_1',
      name: 'Shop',
      type: 'shoes',
      town: '',
      currency: 'ZMW',
      language: 'en',
      usesBarcodes: false,
      lowStockDefault: 3,
      turnoverTaxRegistered: false,
      providersJson: [],
      onboardingCompleted: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await applyPulledChange(db, {
      entity: 'shop',
      entityId: 'shop_1',
      operation: 'create',
      payload: shop,
      cursor: '1',
      clientCreatedAt: NOW,
    });
    await applyPulledChange(db, {
      entity: 'product',
      entityId: 'prod_1',
      operation: 'create',
      payload: {
        id: 'prod_1',
        name: 'Sneaker',
        defaultBuyPrice: 30000,
        defaultSellPrice: 45000,
        createdAt: NOW,
        updatedAt: NOW,
      },
      cursor: '2',
      clientCreatedAt: NOW,
    });
    await applyPulledChange(db, {
      entity: 'product_variant',
      entityId: 'var_1',
      operation: 'create',
      payload: {
        id: 'var_1',
        productId: 'prod_1',
        size: '41',
        colour: 'Black',
        barcode: '',
        buyPrice: 30000,
        sellPrice: 45000,
        lowStockLevel: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
      cursor: '3',
      clientCreatedAt: NOW,
    });

    await applyPulledChange(db, {
      entity: 'sale',
      entityId: 'sale_1',
      operation: 'create',
      payload: {
        sale: {
          id: 'sale_1',
          recordedBy: 'owner_1',
          subtotal: 45000,
          discountTotal: 0,
          total: 45000,
          status: 'active',
          reconcileStatus: 'unresolved',
          createdAt: NOW,
          updatedAt: NOW,
        },
        lines: [
          {
            id: 'line_1',
            variantId: 'var_1',
            quantity: 1,
            buyPrice: 30000,
            listPrice: 45000,
            discount: 0,
            finalPrice: 45000,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        payments: [
          {
            id: 'pay_1',
            saleId: 'sale_1',
            method: 'cash',
            amount: 45000,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        stockMovements: [
          {
            id: 'mv_1',
            variantId: 'var_1',
            quantityChange: -1,
            reason: 'sale',
            saleId: 'sale_1',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
      cursor: '4',
      clientCreatedAt: NOW,
    });

    expect(await count(db, 'sale')).toBe(1);
    expect(await count(db, 'sale_line')).toBe(1);
    expect(await count(db, 'payment')).toBe(1);
    expect(await count(db, 'stock_movement')).toBe(1);
    const stock = await db.getFirstAsync<{ quantity: number }>(
      'SELECT quantity FROM variant_stock WHERE variant_id = ?',
      'var_1'
    );
    expect(stock?.quantity).toBe(-1);
  });
});

describe('IT-SYNC Smart Invoice receipts', () => {
  it('stores the ZRA receipt for a sale and marks the shop as connected', async () => {
    expect(await getSmartInvoiceLink(db)).toBeNull();

    await applyPulledChange(db, {
      entity: 'smart_invoice_receipt',
      entityId: 'sale_1:S',
      operation: 'create',
      cursor: '9',
      clientCreatedAt: '2026-11-23T10:00:00+02:00',
      payload: {
        id: 'sale_1:S',
        saleId: 'sale_1',
        receiptType: 'S',
        invoiceNo: 1,
        originalInvoiceNo: 0,
        resultCode: '000',
        resultMessage: 'It is succeeded',
        receiptNo: 1,
        receiptSignature: 'TQZMKL57AGBMSTPO',
        internalData: 'X',
        sdcId: 'SDC-SIM-ABC123',
        mrcNo: 'SIM1234',
        publishedAt: '2026-11-23T10:00:00+02:00',
        simulated: true,
      },
    });

    const receipts = await listSmartInvoiceReceipts(db, 'sale_1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ receiptType: 'S', receiptNo: 1, simulated: true });
    expect((await getSmartInvoiceLink(db))?.sdcId).toBe('SDC-SIM-ABC123');
  });
});
