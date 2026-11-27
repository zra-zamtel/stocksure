import { describe, expect, it } from 'vitest';
import glyphs from '../theme/material-symbols.json';
import { FALLBACK_PRODUCT_ICON, PRODUCT_ICONS, productIcon, tintSlot } from './product-visual';

describe('productIcon', () => {
  it('picks an icon from the category first, then the name', () => {
    expect(productIcon('Shoes', 'Black school shoes')).toBe('steps');
    expect(productIcon('Beer', 'Castle Lager')).toBe('sports_bar');
    expect(productIcon('Pain relief', 'Panadol')).toBe('medication');
    expect(productIcon(undefined, 'Blue cotton shirt')).toBe('checkroom');
    expect(productIcon('Accessories', 'Ladies handbag')).toBe('diamond');
    expect(productIcon(null, 'Ladies handbag')).toBe('shopping_bag');
  });

  it('falls back to a box for anything it does not recognise', () => {
    expect(productIcon('Misc', 'Thing')).toBe(FALLBACK_PRODUCT_ICON);
    expect(productIcon()).toBe(FALLBACK_PRODUCT_ICON);
  });

  it('only uses icons the app can draw', () => {
    const map = glyphs as Record<string, number>;
    for (const icon of PRODUCT_ICONS) expect(map[icon], icon).toBeGreaterThan(0);
  });
});

describe('tintSlot', () => {
  it('is stable and within range', () => {
    expect(tintSlot('prod-1', 6)).toBe(tintSlot('prod-1', 6));
    for (const key of ['a', 'prod-2', 'var_xyz', '']) {
      const slot = tintSlot(key, 6);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(6);
    }
    expect(tintSlot('x', 0)).toBe(0);
  });
});
