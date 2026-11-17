import type { Ngwee, StockMovement, StockState } from './types';

/**
 * Stock is never stored as a mutable number. The quantity on hand is always the
 * sum of movements, so two phones cannot overwrite each other's counts and a
 * void is just another movement.
 */

export function quantityOnHand(
  movements: Pick<StockMovement, 'variantId' | 'quantityChange'>[],
  variantId: string
): number {
  return movements
    .filter((movement) => movement.variantId === variantId)
    .reduce((total, movement) => total + movement.quantityChange, 0);
}

export function stockState(quantity: number, lowStockLevel: number): StockState {
  if (quantity <= 0) return 'out';
  if (quantity <= lowStockLevel) return 'low';
  return 'ok';
}

export function isLowStock(quantity: number, lowStockLevel: number): boolean {
  return stockState(quantity, lowStockLevel) !== 'ok';
}

/** True when the sale would push stock below zero and needs an owner override. */
export function needsOverride(quantity: number, requested: number): boolean {
  return requested > quantity;
}

export function applyMovement(quantity: number, change: number): number {
  return quantity + change;
}

/**
 * Restock takes a whole number of units and optionally a new buy price. A
 * fractional quantity is always a typo, so it is rejected rather than rounded.
 */
export function validateRestock(quantity: number, buyPriceInNgwee?: Ngwee): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(quantity) || quantity <= 0) {
    errors.push('Quantity must be a whole number greater than zero');
  }
  if (buyPriceInNgwee !== undefined) {
    if (!Number.isFinite(buyPriceInNgwee) || buyPriceInNgwee < 0) {
      errors.push('Buy price cannot be negative');
    }
  }
  return errors;
}

/**
 * A void reverses exactly what the sale took, as its own movement, and is
 * linked back to the sale so the pair is visible in history.
 */
export function reversalFor(
  saleMovements: StockMovement[],
  saleId: string,
  at?: string,
  note?: string
): StockMovement[] {
  return saleMovements
    .filter((movement) => movement.saleId === saleId && movement.reason === 'sale')
    .map((movement) => ({
      ...movement,
      // Deterministic, so a replayed void cannot restore stock twice.
      id: `void-${movement.id}`,
      quantityChange: -movement.quantityChange,
      reason: 'void' as const,
      note: note ?? movement.note,
      createdAt: at ?? movement.createdAt,
      updatedAt: at ?? movement.updatedAt,
    }));
}
