import { describe, expect, it } from 'vitest';
import { products, saleLinesData, salesData, stockMovements, taxRules } from './fake';

/**
 * Guards the seed data against the constraints the schema enforces. A seed that
 * violates one rolls the whole transaction back and the app cannot start, which
 * is exactly what happened with a zero-quantity opening movement.
 */
describe('seed data', () => {
  it('never produces a zero-quantity stock movement', () => {
    const zero = stockMovements.filter((movement) => movement.quantityChange === 0);
    expect(zero).toEqual([]);
  });

  it('only uses reasons the schema allows', () => {
    const allowed = new Set(['opening', 'restock', 'sale', 'void', 'correction']);
    for (const movement of stockMovements) expect(allowed.has(movement.reason)).toBe(true);
  });

  it('keeps every sale line pointing at a real variant', () => {
    const variantIds = new Set(products.flatMap((product) => product.variants.map((variant) => variant.id)));
    for (const line of saleLinesData) expect(variantIds.has(line.variantId)).toBe(true);
  });

  it('keeps every sale line pointing at a real sale', () => {
    const saleIds = new Set(salesData.map((sale) => sale.id));
    for (const line of saleLinesData) expect(saleIds.has(line.saleId)).toBe(true);
  });

  it('has a usable tax rules file', () => {
    expect(taxRules.rate).toBeGreaterThan(0);
    expect(taxRules.threshold).toBeGreaterThan(0);
    expect(taxRules.reminderDaysBefore.length).toBeGreaterThan(0);
  });
});
