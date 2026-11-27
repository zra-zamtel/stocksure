import type { SQLiteDatabase } from 'expo-sqlite';
import { cashVariance, estimateTurnoverTax } from '@/core';
import {
  mobileMoneyTxns,
  paymentsData,
  products,
  reconciliation,
  saleLinesData,
  salesData,
  shop,
  stockMovements,
  taxPeriod,
  taxPot,
  taxRules,
} from '@/data/fake';

/**
 * Demo data for the seeded shop. It is inserted once, on an empty database, so
 * the presenter always starts from the same figures. It is not called by
 * initializeDatabase: a real first run goes through onboarding. Replace or
 * extend this when the seed becomes Henry's demo-shop script (#41), and call
 * it explicitly from the demo setup.
 */
export async function seedDemoShop(db: SQLiteDatabase): Promise<void> {
  const existingShop = await db.getFirstAsync<{ id: string }>('SELECT id FROM shop LIMIT 1');
  if (existingShop) return;

  const existing = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM product');
  if (existing && existing.count > 0) return;

  const activeSales = salesData.filter((sale) => sale.status === 'active');
  const turnover = activeSales.reduce((sum, sale) => sum + sale.total, 0);
  const estimate = estimateTurnoverTax(turnover, taxRules);
  const cashSales = paymentsData
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const { expected } = cashVariance(reconciliation.openingFloat, cashSales, 0);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO shop (id, name, type, profile_id, town, currency, language, uses_barcodes, low_stock_default,
         turnover_tax_registered, tpin, providers_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      shop.id,
      shop.name,
      shop.type,
      shop.profileId,
      shop.town,
      shop.currency,
      shop.language,
      shop.usesBarcodes ? 1 : 0,
      shop.lowStockDefault,
      shop.turnoverTaxRegistered ? 1 : 0,
      shop.tpin ?? null,
      JSON.stringify(shop.providers),
      shop.createdAt,
      shop.updatedAt
    );

    for (const product of products) {
      await db.runAsync(
        `INSERT INTO product (id, name, category, photo_uri, default_buy_price, default_sell_price,
           discount_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        product.id,
        product.name,
        product.category ?? null,
        product.photoUri ?? null,
        product.defaultBuyPrice,
        product.defaultSellPrice,
        product.discount ? JSON.stringify(product.discount) : null,
        product.createdAt,
        product.updatedAt
      );

      for (const variant of product.variants) {
        await db.runAsync(
          `INSERT INTO product_variant (id, product_id, size, colour, barcode, buy_price, sell_price,
             low_stock_level, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          variant.id,
          variant.productId,
          variant.size ?? null,
          variant.colour ?? null,
          variant.barcode ?? null,
          variant.buyPrice,
          variant.sellPrice,
          variant.lowStockLevel,
          variant.createdAt,
          variant.updatedAt
        );
      }
    }

    for (const movement of stockMovements) {
      // A zero movement is meaningless and the schema rejects it. An
      // out-of-stock variant simply has no opening movement at all.
      if (movement.quantityChange === 0) continue;
      await db.runAsync(
        `INSERT INTO stock_movement (id, variant_id, quantity_change, reason, note, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        movement.id,
        movement.variantId,
        movement.quantityChange,
        movement.reason,
        movement.note ?? null,
        movement.saleId ?? null,
        movement.createdAt,
        movement.updatedAt
      );
    }

    for (const sale of salesData) {
      await db.runAsync(
        `INSERT INTO sale (id, recorded_by, subtotal, discount_total, total, status, void_reason,
           reconcile_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sale.id,
        sale.recordedBy,
        sale.subtotal,
        sale.discountTotal,
        sale.total,
        sale.status,
        sale.voidReason ?? null,
        sale.reconcileStatus,
        sale.createdAt,
        sale.updatedAt
      );
    }

    for (const line of saleLinesData) {
      await db.runAsync(
        `INSERT INTO sale_line (id, sale_id, variant_id, quantity, buy_price, list_price, discount,
           final_price, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        line.id,
        line.saleId,
        line.variantId,
        line.quantity,
        line.buyPrice,
        line.listPrice,
        line.discount,
        line.finalPrice,
        line.createdAt,
        line.updatedAt
      );
    }

    for (const payment of paymentsData) {
      await db.runAsync(
        `INSERT INTO payment (id, sale_id, method, provider, amount, mobile_money_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        payment.id,
        payment.saleId,
        payment.method,
        payment.provider ?? null,
        payment.amount,
        payment.mobileMoneyReference ?? null,
        payment.createdAt,
        payment.updatedAt
      );
    }

    for (const txn of mobileMoneyTxns) {
      await db.runAsync(
        `INSERT INTO mobile_money_txn (id, provider, amount, sender, reference, received_at, raw_message,
           parsed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        txn.id,
        txn.provider,
        txn.amount,
        txn.sender ?? null,
        txn.reference ?? null,
        txn.receivedAt,
        txn.rawMessage,
        txn.parsed ? 1 : 0,
        txn.createdAt,
        txn.updatedAt
      );
    }

    await db.runAsync(
      `INSERT INTO reconciliation (id, day, matched_count, sale_no_payment_count, payment_no_sale_count,
         opening_float, counted_cash, expected_cash, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reconciliation.id,
      reconciliation.day,
      reconciliation.matchedCount,
      reconciliation.saleNoPaymentCount,
      reconciliation.paymentNoSaleCount,
      reconciliation.openingFloat,
      reconciliation.countedCash ?? null,
      expected,
      reconciliation.note ?? null,
      reconciliation.createdAt,
      reconciliation.updatedAt
    );

    await db.runAsync(
      `INSERT INTO tax_period (id, starts_on, ends_on, turnover, rate_used, estimated_tax, due_on, paid,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taxPeriod.id,
      taxPeriod.startsOn,
      taxPeriod.endsOn,
      turnover,
      estimate.rate,
      estimate.estimatedTax,
      taxPeriod.dueOn,
      taxPeriod.paid ? 1 : 0,
      taxPeriod.createdAt,
      taxPeriod.updatedAt
    );

    for (const entry of taxPot) {
      await db.runAsync(
        `INSERT INTO tax_pot_entry (id, amount, kind, period_id, sale_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.amount,
        entry.kind,
        entry.periodId,
        entry.saleId ?? null,
        entry.createdAt,
        entry.updatedAt
      );
    }
  });
}
