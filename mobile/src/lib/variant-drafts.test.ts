import { describe, expect, it } from 'vitest';
import { draftsToVariants, emptyDraft, nextDraft, type DraftOptions, type DraftVariant } from './variant-drafts';

const bar: DraftOptions = {
  axes: [{ key: 'pack' }, { key: 'size' }],
  usesBarcodes: true,
  usesExpiry: false,
  usesBatch: false,
  lowStockDefault: 3,
};

function draft(key: string, extra: Partial<DraftVariant> = {}): DraftVariant {
  return { ...emptyDraft(key), buyPrice: '10', sellPrice: '15', quantity: '4', ...extra };
}

describe('draftsToVariants', () => {
  it('turns rows into variants in axis order, with prices in ngwee', () => {
    const result = draftsToVariants(
      [
        draft('a', { attributes: { pack: 'Bottle', size: '330 ml' }, barcode: '6001234500018' }),
        draft('b', { attributes: { pack: 'Crate' }, buyPrice: '200', sellPrice: '280', quantity: '2', lowStock: '1' }),
      ],
      bar
    );
    expect(result).toEqual({
      ok: true,
      variants: [
        {
          attributes: [
            { key: 'pack', value: 'Bottle' },
            { key: 'size', value: '330 ml' },
          ],
          barcode: '6001234500018',
          buyPrice: 1000,
          sellPrice: 1500,
          openingQuantity: 4,
          lowStockLevel: 3,
          expiryDate: undefined,
          batchNo: undefined,
        },
        {
          attributes: [
            { key: 'pack', value: 'Crate' },
            { key: 'size', value: '' },
          ],
          barcode: undefined,
          buyPrice: 20000,
          sellPrice: 28000,
          openingQuantity: 2,
          lowStockLevel: 1,
          expiryDate: undefined,
          batchNo: undefined,
        },
      ],
    });
  });

  it('refuses two rows that are the same variant, ignoring case and spaces', () => {
    const result = draftsToVariants(
      [draft('a', { attributes: { pack: 'Crate' } }), draft('b', { attributes: { pack: ' crate ' } })],
      bar
    );
    expect(result).toEqual({ ok: false, problem: { row: 2, code: 'duplicateVariant', otherRow: 1 } });
  });

  it('refuses two rows with the same barcode, comparing the saved form', () => {
    const result = draftsToVariants(
      [
        draft('a', { attributes: { pack: 'Bottle' }, barcode: '012345678905' }),
        draft('b', { attributes: { pack: 'Can' }, barcode: '0012345678905' }),
      ],
      bar
    );
    expect(result).toEqual({
      ok: false,
      problem: { row: 2, code: 'duplicateBarcode', otherRow: 1, barcode: '0012345678905' },
    });
  });

  it('needs a variant value on every row once there is more than one', () => {
    const result = draftsToVariants([draft('a', { attributes: { pack: 'Bottle' } }), draft('b')], bar);
    expect(result).toEqual({ ok: false, problem: { row: 2, code: 'noAxisValue' } });
    // A single row may leave the axes empty, as before.
    expect(draftsToVariants([draft('a')], bar).ok).toBe(true);
  });

  it('points at the row with a bad price, quantity or expiry', () => {
    expect(draftsToVariants([draft('a', { sellPrice: '' })], bar)).toEqual({
      ok: false,
      problem: { row: 1, code: 'sellPrice', priceError: 'empty' },
    });
    expect(draftsToVariants([draft('a', { attributes: { pack: 'A' } }), draft('b', { attributes: { pack: 'B' }, quantity: '' })], bar)).toEqual({
      ok: false,
      problem: { row: 2, code: 'quantity' },
    });
    const beauty = { ...bar, usesExpiry: true, usesBatch: true };
    expect(draftsToVariants([draft('a', { expiryDate: '2027-02-30' })], beauty)).toEqual({
      ok: false,
      problem: { row: 1, code: 'expiry' },
    });
    const saved = draftsToVariants([draft('a', { expiryDate: '2027-06-30', batchNo: ' b1 ' })], beauty);
    expect(saved.ok && saved.variants[0]).toMatchObject({ expiryDate: '2027-06-30', batchNo: 'b1' });
  });

  it('sorts a salaula bale into Top and Down grades at their own prices', () => {
    const salaula = { ...bar, axes: [{ key: 'grade' }], usesBarcodes: false };
    const result = draftsToVariants(
      [
        draft('a', { attributes: { grade: 'Top' }, buyPrice: '20', sellPrice: '80', quantity: '30' }),
        draft('b', { attributes: { grade: 'Down' }, buyPrice: '20', sellPrice: '25', quantity: '70' }),
      ],
      salaula
    );
    expect(result.ok && result.variants.map((variant) => [variant.attributes, variant.sellPrice, variant.openingQuantity])).toEqual([
      [[{ key: 'grade', value: 'Top' }], 8000, 30],
      [[{ key: 'grade', value: 'Down' }], 2500, 70],
    ]);
  });

  it('ignores barcode, expiry and batch when the shop or trade does not use them', () => {
    const plain = { ...bar, usesBarcodes: false };
    const result = draftsToVariants([draft('a', { barcode: '6001234500018', expiryDate: 'junk', batchNo: 'X' })], plain);
    expect(result.ok && result.variants[0]).toMatchObject({ barcode: undefined, expiryDate: undefined, batchNo: undefined });
  });
});

describe('nextDraft', () => {
  it('copies prices and the low-stock level, and clears the rest', () => {
    const last = draft('a', { attributes: { pack: 'Crate' }, barcode: '1', lowStock: '2', expiryDate: '2027-01-01' });
    expect(nextDraft(last, 'b')).toEqual({ ...emptyDraft('b'), buyPrice: '10', sellPrice: '15', lowStock: '2' });
    expect(nextDraft(undefined, 'c')).toEqual(emptyDraft('c'));
  });
});
