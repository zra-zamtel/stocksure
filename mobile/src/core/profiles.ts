// Shop profiles: one config per trade that sets the catalogue vocabulary
// (variant axes, category suggestions, units) and a few defaults. Tax,
// reconciliation, sync and USSD do not read this; only the screens do.
// Framework-free so it runs in plain Node tests; the UI casts `icon`.

import type { ProfileId, ShopType, VariantAttribute } from './types';

export type ProfileModule = 'expiry' | 'batch' | 'saleWarning' | 'discounts';

export interface ProfileAxis {
  /** Stable key stored in attributes_json, e.g. 'size', 'shade', 'pack'. */
  key: string;
  /** i18n key for the field label, e.g. 'field.size'. */
  labelKey: string;
  /** Example value shown in the input, e.g. 'M' or '100 ml'. */
  placeholder: string;
  /** One-tap values shown under the input. */
  quickPicks: string[];
  maxLength: number;
}

export interface ShopProfile {
  id: ProfileId;
  /** Material Symbols name; the UI casts it to AndroidSymbol. */
  icon: string;
  nameKey: string;
  captionKey: string;
  /** Value written to the legacy shop.type column. */
  legacyType: ShopType;
  /** False when the trade never scans anything (services); the shop then has no barcode UI at all. */
  barcodesAvailable: boolean;
  /** Starting answer to "Does your shop use barcodes?". The owner can change it when available. */
  barcodesDefault: boolean;
  trackStockDefault: boolean;
  /** Salaula: every piece is one-off, so quantity is always 1. */
  uniqueItems: boolean;
  axes: ProfileAxis[];
  /** Suggestions, not a constraint. The owner can still type a category. */
  categories: string[];
  units: string[];
  defaultUnit: string;
  lowStockDefault: number;
  modules: ProfileModule[];
}

const CLOTHING_SIZES = ['S', 'M', 'L', 'XL', 'XXL', '36', '38', '40', '42', '44'];
const COLOURS = ['Black', 'White', 'Blue', 'Brown', 'Beige', 'Grey'];
const BEAUTY_VARIANTS = ['Fair', 'Medium', 'Deep', 'SPF 30', 'SPF 50', '250 mg', '500 mg'];
const BEAUTY_PACKS = ['50 ml', '100 ml', '200 ml', 'Strip of 10', 'Box of 100'];
const BAR_PACKS = ['Bottle', 'Crate', 'Can', 'Shot'];
const BAR_SIZES = ['330 ml', '500 ml', '750 ml', '1 L'];
const GROCERY_SIZES = ['Single', '500 g', '1 kg', '2 kg', '5 kg'];
const GROCERY_PACKS = ['Single', 'Pack of 6', 'Pack of 12'];
const HARDWARE_SIZES = ['10 mm', '15 mm', '20 mm', '1 m', '2 m', '5 m'];
const HARDWARE_UNITS = ['Piece', 'Metre', 'Kilogram', 'Bag', 'Roll'];
const ELECTRONICS_STORAGE = ['32 GB', '64 GB', '128 GB', '256 GB', '512 GB'];
const ELECTRONICS_COLOURS = ['Black', 'White', 'Blue', 'Silver'];

export const PROFILES: ShopProfile[] = [
  {
    id: 'fashion',
    icon: 'checkroom',
    nameKey: 'profile.fashion',
    captionKey: 'profile.fashion.caption',
    legacyType: 'clothes',
    barcodesAvailable: true,
    barcodesDefault: false,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      { key: 'size', labelKey: 'field.size', placeholder: 'M', quickPicks: CLOTHING_SIZES, maxLength: 20 },
      { key: 'colour', labelKey: 'field.colour', placeholder: 'Black', quickPicks: COLOURS, maxLength: 40 },
    ],
    categories: ['Dresses', 'Shirts', 'Trousers', 'Chitenge', 'Shoes', 'Bags', 'Accessories'],
    units: ['piece'],
    defaultUnit: 'piece',
    lowStockDefault: 3,
    modules: ['discounts'],
  },
  {
    id: 'salaula',
    icon: 'dry_cleaning',
    nameKey: 'profile.salaula',
    captionKey: 'profile.salaula.caption',
    legacyType: 'clothes',
    barcodesAvailable: true,
    barcodesDefault: false,
    trackStockDefault: true,
    uniqueItems: true,
    axes: [],
    categories: ['Women', 'Men', 'Children', 'Shoes', 'Bags', 'Household'],
    units: ['piece'],
    defaultUnit: 'piece',
    lowStockDefault: 1,
    modules: ['discounts'],
  },
  {
    id: 'health_beauty',
    icon: 'spa',
    nameKey: 'profile.health_beauty',
    captionKey: 'profile.health_beauty.caption',
    legacyType: 'other',
    barcodesAvailable: true,
    barcodesDefault: true,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      {
        key: 'variant',
        labelKey: 'field.variant',
        placeholder: 'Medium / 500 mg',
        quickPicks: BEAUTY_VARIANTS,
        maxLength: 40,
      },
      {
        key: 'pack',
        labelKey: 'field.packSize',
        placeholder: '100 ml / Strip of 10',
        quickPicks: BEAUTY_PACKS,
        maxLength: 30,
      },
    ],
    categories: [
      'Skincare', 'Makeup', 'Hair', 'Fragrance', 'Nails',
      'Pain relief', 'Vitamins', 'First aid', 'Baby',
    ],
    units: ['piece', 'pack', 'strip', 'box', 'bottle', 'tube'],
    defaultUnit: 'piece',
    lowStockDefault: 3,
    modules: ['expiry', 'batch', 'saleWarning', 'discounts'],
  },
  {
    id: 'bar',
    icon: 'local_bar',
    nameKey: 'profile.bar',
    captionKey: 'profile.bar.caption',
    legacyType: 'other',
    barcodesAvailable: true,
    barcodesDefault: true,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      { key: 'pack', labelKey: 'field.pack', placeholder: 'Bottle', quickPicks: BAR_PACKS, maxLength: 20 },
      { key: 'size', labelKey: 'field.size', placeholder: '330 ml', quickPicks: BAR_SIZES, maxLength: 20 },
    ],
    categories: ['Beer', 'Spirits', 'Wine', 'Soft drinks', 'Snacks'],
    units: ['bottle', 'crate', 'can', 'shot', 'pack'],
    defaultUnit: 'bottle',
    lowStockDefault: 3,
    modules: ['saleWarning', 'discounts'],
  },
  {
    id: 'grocery',
    icon: 'shopping_basket',
    nameKey: 'profile.grocery',
    captionKey: 'profile.grocery.caption',
    legacyType: 'general',
    barcodesAvailable: true,
    barcodesDefault: true,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      { key: 'size', labelKey: 'field.size', placeholder: '1 kg', quickPicks: GROCERY_SIZES, maxLength: 20 },
      { key: 'pack', labelKey: 'field.pack', placeholder: 'Single', quickPicks: GROCERY_PACKS, maxLength: 20 },
    ],
    categories: ['Food', 'Drinks', 'Household', 'Personal care', 'Frozen', 'Baby'],
    units: ['piece', 'pack', 'kg', 'g', 'litre', 'ml'],
    defaultUnit: 'piece',
    lowStockDefault: 5,
    modules: ['expiry', 'discounts'],
  },
  {
    id: 'hardware',
    icon: 'handyman',
    nameKey: 'profile.hardware',
    captionKey: 'profile.hardware.caption',
    legacyType: 'general',
    barcodesAvailable: true,
    barcodesDefault: false,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      { key: 'size', labelKey: 'field.size', placeholder: '15 mm', quickPicks: HARDWARE_SIZES, maxLength: 20 },
      { key: 'unit', labelKey: 'field.unit', placeholder: 'Piece', quickPicks: HARDWARE_UNITS, maxLength: 20 },
    ],
    categories: ['Tools', 'Electrical', 'Plumbing', 'Paint', 'Building', 'Fasteners'],
    units: ['piece', 'metre', 'kilogram', 'bag', 'roll'],
    defaultUnit: 'piece',
    lowStockDefault: 3,
    modules: ['discounts'],
  },
  {
    id: 'electronics',
    icon: 'devices',
    nameKey: 'profile.electronics',
    captionKey: 'profile.electronics.caption',
    legacyType: 'other',
    barcodesAvailable: true,
    barcodesDefault: true,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [
      {
        key: 'storage',
        labelKey: 'field.storage',
        placeholder: '128 GB',
        quickPicks: ELECTRONICS_STORAGE,
        maxLength: 20,
      },
      { key: 'colour', labelKey: 'field.colour', placeholder: 'Black', quickPicks: ELECTRONICS_COLOURS, maxLength: 40 },
    ],
    categories: ['Phones', 'Chargers', 'Cases', 'Earphones', 'Cables', 'Accessories'],
    units: ['piece'],
    defaultUnit: 'piece',
    lowStockDefault: 2,
    modules: ['saleWarning', 'discounts'],
  },
  {
    id: 'salon',
    icon: 'content_cut',
    nameKey: 'profile.salon',
    captionKey: 'profile.salon.caption',
    legacyType: 'other',
    barcodesAvailable: false,
    barcodesDefault: false,
    trackStockDefault: false,
    uniqueItems: false,
    axes: [],
    categories: ['Hair', 'Nails', 'Barber', 'Beauty', 'Repairs'],
    units: ['service'],
    defaultUnit: 'service',
    lowStockDefault: 0,
    modules: [],
  },
  {
    id: 'general',
    icon: 'storefront',
    nameKey: 'profile.general',
    captionKey: 'profile.general.caption',
    legacyType: 'general',
    barcodesAvailable: true,
    barcodesDefault: true,
    trackStockDefault: true,
    uniqueItems: false,
    axes: [],
    categories: ['Food', 'Drinks', 'Household', 'Clothing', 'Electronics', 'Other'],
    units: ['piece', 'pack', 'box', 'kg'],
    defaultUnit: 'piece',
    lowStockDefault: 3,
    modules: ['discounts'],
  },
];

export const PROFILE_BY_ID = Object.fromEntries(
  PROFILES.map((profile) => [profile.id, profile])
) as Record<ProfileId, ShopProfile>;

export function profileForShop(
  shop: { profileId?: string | null; type?: ShopType } | null | undefined
): ShopProfile {
  if (!shop) return PROFILE_BY_ID.general;
  const direct = shop.profileId ? PROFILE_BY_ID[shop.profileId as ProfileId] : undefined;
  if (direct) return direct;
  if (shop.type === 'clothes' || shop.type === 'shoes') return PROFILE_BY_ID.fashion;
  return PROFILE_BY_ID.general;
}

/** Whether the shop gets barcode fields, scanning and labels: the trade must allow it and the owner must want it. */
export function shopUsesBarcodes(profileId: ProfileId, ownerChoice: boolean): boolean {
  return (PROFILE_BY_ID[profileId] ?? PROFILE_BY_ID.general).barcodesAvailable && ownerChoice;
}

export function legacyTypeForProfile(id: ProfileId): ShopType {
  return PROFILE_BY_ID[id].legacyType;
}

/**
 * The one place that builds a variant label. Use it in the sale, product and
 * stock screens instead of joining size/colour by hand.
 */
export function variantLabel(
  productName: string,
  variant: { size?: string | null; colour?: string | null; attributes?: VariantAttribute[] }
): string {
  const values = variant.attributes?.length
    ? variant.attributes.map((attribute) => attribute.value)
    : [variant.size, variant.colour];
  // An empty product name is dropped too, so variantLabel('', v) is just the variant.
  return [productName, ...values].filter(Boolean).join(' · ');
}
