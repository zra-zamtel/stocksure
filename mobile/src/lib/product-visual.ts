// How a product looks when it has no photo yet: a tinted square with an icon
// for what it is. Pure so it can be tested without rendering.
import type { AndroidSymbol } from 'expo-symbols';

/** First match wins; categories are checked before the product name. */
const RULES: readonly [RegExp, AndroidSymbol][] = [
  [/shoe|sneaker|sandal|boot|slipper|heel/i, 'steps'],
  [/bag|purse|wallet/i, 'shopping_bag'],
  [/dress|shirt|blouse|top|trouser|jean|skirt|chitenge|cloth|jacket|women|men|child|kid|salaula|bale/i, 'checkroom'],
  [/beer|lager|spirit|wine|whisk|vodka|gin|brandy/i, 'sports_bar'],
  [/drink|soda|juice|water|cola|soft/i, 'local_drink'],
  [/bread|cake|bun|scone/i, 'bakery_dining'],
  [/snack|food|rice|mealie|maize|sugar|salt|oil|flour|frozen|grocer|kapenta|fish|meat/i, 'grocery'],
  [/phone|charger|cable|earphone|headphone|electronic|case|battery/i, 'smartphone'],
  [/pain|vitamin|first aid|medic|tablet|pill|syrup|pharm/i, 'medication'],
  [/skin|makeup|hair|fragrance|perfume|nail|cream|lotion|beauty|lip|soap/i, 'spa'],
  [/baby|nappy|diaper/i, 'child_care'],
  [/household|clean|detergent|bleach|broom/i, 'cleaning_services'],
  [/accessor|sock|belt|hat|cap|jewel|earring|watch|ring/i, 'diamond'],
];

export const FALLBACK_PRODUCT_ICON: AndroidSymbol = 'inventory_2';

export function productIcon(category?: string | null, name?: string | null): AndroidSymbol {
  for (const text of [category, name]) {
    if (!text) continue;
    for (const [pattern, icon] of RULES) if (pattern.test(text)) return icon;
  }
  return FALLBACK_PRODUCT_ICON;
}

/** Every icon this module can return, for the glyph test. */
export const PRODUCT_ICONS: readonly AndroidSymbol[] = [...RULES.map(([, icon]) => icon), FALLBACK_PRODUCT_ICON];

/**
 * A stable tint slot for a product, so the same product keeps its colour on
 * every screen. Hashing the id (not the name) keeps two "Shirt"s apart.
 */
export function tintSlot(key: string, slots: number): number {
  if (slots <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % slots;
}
