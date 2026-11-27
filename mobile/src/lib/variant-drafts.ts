// What the product form holds for each variant row while the owner types, and
// the checks that turn those rows into variants the repo can save. Kept out of
// the screen so the rules are tested without rendering anything.
import {
  attributesKey,
  cleanAttributes,
  isValidIsoDate,
  normaliseBarcode,
  parsePrice,
  type PriceError,
  type VariantAttribute,
} from '@/core';
import type { VariantInput } from '@/db/repos';

export interface DraftVariant {
  /** Stable React key; never shown. */
  key: string;
  /** Typed values per profile axis key, e.g. { pack: 'Crate', size: '330 ml' }. */
  attributes: Record<string, string>;
  barcode: string;
  buyPrice: string;
  sellPrice: string;
  quantity: string;
  lowStock: string;
  expiryDate: string;
  batchNo: string;
}

export function emptyDraft(key: string, barcode = ''): DraftVariant {
  return {
    key,
    attributes: {},
    barcode,
    buyPrice: '',
    sellPrice: '',
    // Empty, not a pre-filled "1": a real-looking value is easy to save by mistake.
    quantity: '',
    lowStock: '',
    expiryDate: '',
    batchNo: '',
  };
}

/** "Add another": same prices and low-stock level as the last row, everything else fresh. */
export function nextDraft(last: DraftVariant | undefined, key: string): DraftVariant {
  const draft = emptyDraft(key);
  if (!last) return draft;
  return { ...draft, buyPrice: last.buyPrice, sellPrice: last.sellPrice, lowStock: last.lowStock };
}

export interface DraftOptions {
  /** The profile's axes, in order. */
  axes: { key: string }[];
  usesBarcodes: boolean;
  usesExpiry: boolean;
  usesBatch: boolean;
  lowStockDefault?: number;
}

export type DraftProblem =
  | { row: number; code: 'buyPrice' | 'sellPrice'; priceError: PriceError }
  | { row: number; code: 'quantity' | 'expiry' | 'noAxisValue' }
  | { row: number; code: 'duplicateVariant'; otherRow: number }
  | { row: number; code: 'duplicateBarcode'; otherRow: number; barcode: string };

export type DraftResult = { ok: true; variants: VariantInput[] } | { ok: false; problem: DraftProblem };

/** Rows are numbered from 1 in problems, as the owner sees them. */
export function draftsToVariants(drafts: DraftVariant[], options: DraftOptions): DraftResult {
  const variants: VariantInput[] = [];
  const combinations = new Map<string, number>();
  const barcodes = new Map<string, number>();

  for (const [index, draft] of drafts.entries()) {
    const row = index + 1;
    const buy = parsePrice(draft.buyPrice);
    if (!buy.ok) return { ok: false, problem: { row, code: 'buyPrice', priceError: buy.error } };
    const sell = parsePrice(draft.sellPrice);
    if (!sell.ok) return { ok: false, problem: { row, code: 'sellPrice', priceError: sell.error } };

    const quantity = Number.parseInt(draft.quantity, 10);
    if (draft.quantity.trim() === '' || !Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, problem: { row, code: 'quantity' } };
    }

    const expiryDate = options.usesExpiry ? draft.expiryDate.trim() : '';
    if (expiryDate && !isValidIsoDate(expiryDate)) return { ok: false, problem: { row, code: 'expiry' } };

    // Axis order is kept, empty values included, so the repo mirrors the first
    // axis into size and the second into colour even when one is left blank.
    const attributes: VariantAttribute[] = options.axes.map((axis) => ({
      key: axis.key,
      value: draft.attributes[axis.key] ?? '',
    }));
    if (drafts.length > 1 && options.axes.length > 0 && cleanAttributes(attributes).length === 0) {
      return { ok: false, problem: { row, code: 'noAxisValue' } };
    }
    const combination = attributesKey(attributes);
    const sameAs = combinations.get(combination);
    if (sameAs !== undefined) return { ok: false, problem: { row, code: 'duplicateVariant', otherRow: sameAs } };
    combinations.set(combination, row);

    const barcode = options.usesBarcodes && draft.barcode.trim() ? normaliseBarcode(draft.barcode) : undefined;
    if (barcode) {
      const otherRow = barcodes.get(barcode);
      if (otherRow !== undefined) {
        return { ok: false, problem: { row, code: 'duplicateBarcode', otherRow, barcode } };
      }
      barcodes.set(barcode, row);
    }

    variants.push({
      attributes,
      barcode,
      buyPrice: buy.ngwee,
      sellPrice: sell.ngwee,
      openingQuantity: quantity,
      lowStockLevel: Number.parseInt(draft.lowStock, 10) || options.lowStockDefault,
      expiryDate: expiryDate || undefined,
      batchNo: options.usesBatch ? draft.batchNo.trim() || undefined : undefined,
    });
  }

  return { ok: true, variants };
}
