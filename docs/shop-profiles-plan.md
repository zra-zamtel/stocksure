# StockSure — Dynamic Shop Profiles

**Status:** ready to build
**Date:** 27 November 2026
**Primary owner:** Elton (mobile)
**Backend/sync:** Tabo
**QA/demo data:** Henry
**Design:** Given
**Pitch:** Happy

> Read this whole file before changing code. Build in slices, in order.
> **Start with Slice 1 only.** Do not jump ahead to the multi-variant editor.
>
> If you are an AI agent: implement **Slice 1**, run the checks in section 0,
> then stop and report what changed. Do not start Slice 2 in the same pass
> unless the human explicitly asks for it.

> **Scope cut (27 Nov 2026):** the `salon` and `hardware` profiles and the
> service mode (`track_stock`, the "Service" pill, skipping stock for services)
> are out of this phase. Seven profiles ship. Where this plan still mentions
> them (sections 2.1, 3.3, 4.2, 7, 9.2, 10, 13), skip those parts.

---

## 0. TL;DR for the building agent

1. The app is offline-first. All reads and writes go to SQLite first; the outbox syncs later. Never make a screen wait on the network.
2. `size` and `colour` are **legacy slots**. Keep writing them as mirrors of the first two variant attributes. Never remove them.
3. Add migrations by appending to `mobile/src/db/schema.ts`. Never edit a released migration.
4. Do not change tax, reconciliation, TaxPot or the USSD menu logic, except the label and `track_stock` fixes listed in Slice 2/3.
5. Do not revert unrelated uncommitted changes in the working tree. Work on a branch.
6. Each slice ends with:

   ```powershell
   cd mobile
   npm run typecheck
   npm run lint
   npm test
   ```

   and, if the backend changed:

   ```powershell
   cd backend
   python manage.py test
   ```

---

## 1. Why this exists

The app stores a shop type (`clothes`, `shoes`, `general`, `other`) but only uses it as a label. The product model is hard-wired to a clothes shop:

- `product_variant` has fixed `size` and `colour` columns.
- Category is free text with no suggestions.
- No unit, expiry, batch or stock-on/off.
- `createProduct` creates exactly one variant (`mobile/src/db/repos.ts:1163`); extra sizes/colours are still TODO #30.

A cosmetics shop, pharmacy, bar, salaula stall or electronics shop can record sales, but the product screens do not speak its language. The goal is not eight apps. It is one core with a **shop profile** that configures the catalogue UI and a few optional fields. Tax, reconciliation, USSD, sync and TaxPot stay unchanged.

---

## 2. The model

Three layers:

1. **Profile** — a config file per trade: labels, categories, variant axes, defaults, modules.
2. **Generic product data** — variants become attribute lists instead of `size`/`colour`; products get unit, stock on/off, expiry, batch and a sale warning.
3. **Module-aware screens** — the product form, sale screen, products list and Home show only what the profile needs.

### 2.1 Profiles to ship

| Profile | Variant axes | Extra fields | Modules on | Special |
|---|---|---|---|---|
| `fashion` | Size, Colour | — | discounts | Current demo |
| `salaula` | — | — | discounts | One-off item, qty 1, no barcode |
| `health_beauty` | Variant (shade/strength), Size/Pack | Expiry, Batch, Unit | expiry, batch, sale warning, discounts | "Rx only" warning; cosmetics + pharmacy together |
| `bar` | Pack (Bottle/Crate/Can/Shot), Size | — | sale warning, discounts | "18+" warning |
| `grocery` | Size/Weight, Pack | Expiry, Unit | expiry, discounts | 500 g / 1 kg packs |
| `hardware` | Size, Unit | Unit | discounts | Whole metres/pieces only |
| `electronics` | Model/Storage, Colour | — | sale warning, discounts | Serial/IMEI later |
| `salon` | — | — | — | No stock |
| `general` | — | — | discounts | Fallback |

### 2.2 Design rules

1. **Profile = config, not code.** Adding a trade must not require a schema migration.
2. **Additive migrations only.** Old records, old payloads and the backend must keep working.
3. **No generic form engine.** A profile has at most two axes and three optional fields. Render them explicitly.
4. **One app, one shop.** No multi-shop, no separate builds.
5. **Demo path first.** Clothing must keep working exactly as it does today.

---

## 3. Profile catalogue

### 3.1 Profile IDs

Add to `mobile/src/core/types.ts`:

```ts
export type ProfileId =
  | 'fashion'
  | 'salaula'
  | 'health_beauty'
  | 'bar'
  | 'grocery'
  | 'hardware'
  | 'electronics'
  | 'salon'
  | 'general';
```

Keep the existing `ShopType` unchanged for the legacy sync/USSD field:

```ts
export type ShopType = 'clothes' | 'shoes' | 'general' | 'other';
```

### 3.2 New file: `mobile/src/core/profiles.ts`

Use `icon: string` in core so the module stays framework-free and testable in plain Node. Cast to `AndroidSymbol` at the UI boundary.

```ts
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
```

### 3.3 Full profile definitions

```ts
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
  return [productName, ...values.filter(Boolean)].join(' · ');
}
```

Export the new module from `mobile/src/core/index.ts`:

```ts
export * from './profiles';
```

### 3.4 Profile tests

Create `mobile/src/core/profiles.test.ts`:

- Every profile id is unique.
- Every profile has at least one category and one unit.
- `axes.length <= 2`.
- Every axis has a non-empty `labelKey`, `placeholder` and `maxLength`.
- Every `nameKey` and `captionKey` exists in `mobile/src/i18n/en.json`.
- `legacyTypeForProfile` returns a valid `ShopType` for all profiles.
- `profileForShop` maps `clothes`/`shoes` to `fashion`, unknown ids to `general`.
- `variantLabel` handles attributes, legacy size/colour and empty values.

---

## 4. Data model and migrations

### 4.1 Slice 1 — shop profile (v10)

Append to `mobile/src/db/schema.ts`:

```sql
ALTER TABLE shop ADD COLUMN profile_id TEXT;

UPDATE shop SET profile_id = CASE type
  WHEN 'clothes' THEN 'fashion'
  WHEN 'shoes'   THEN 'fashion'
  WHEN 'general' THEN 'general'
  ELSE 'general'
END
WHERE profile_id IS NULL;
```

No `CHECK` constraint on `profile_id`: adding a trade later must not need a migration.

### 4.2 Slice 2 — product fields (v11)

```sql
ALTER TABLE product ADD COLUMN unit TEXT;
ALTER TABLE product ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1));
ALTER TABLE product ADD COLUMN sale_warning TEXT;

ALTER TABLE product_variant ADD COLUMN expiry_date TEXT;
ALTER TABLE product_variant ADD COLUMN batch_no TEXT;
```

### 4.3 Slice 3 — generic attributes (v12)

```sql
ALTER TABLE product_variant ADD COLUMN attributes_json TEXT;
```

Read fallback:

```ts
export function attributesOf(row: {
  attributesJson?: string | null;
  size?: string | null;
  colour?: string | null;
}): VariantAttribute[] {
  if (row.attributesJson) {
    try {
      const parsed = JSON.parse(row.attributesJson) as VariantAttribute[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to the legacy columns
    }
  }
  return [
    row.size ? { key: 'size', value: row.size } : null,
    row.colour ? { key: 'colour', value: row.colour } : null,
  ].filter(Boolean) as VariantAttribute[];
}
```

Write both:

```ts
const [first, second] = attributes;
// Legacy mirrors: old payloads, old records and the backend still read these.
const size = first?.value ?? null;
const colour = second?.value ?? null;
```

### 4.4 TypeScript types

`mobile/src/core/types.ts`:

```ts
export interface VariantAttribute {
  key: string;
  value: string;
}

export interface Shop extends BaseRecord {
  // ...existing fields
  type: ShopType;        // legacy mirror
  profileId: ProfileId;  // new
}

export interface Product extends BaseRecord {
  // ...existing fields
  unit: string;          // default 'piece'
  trackStock: boolean;   // default true
  saleWarning?: string;  // 'Rx only', '18+', custom
}

export interface ProductVariant extends BaseRecord {
  // ...existing fields
  /** Optional in the type so old fixtures still compile; repos always populate it. */
  attributes?: VariantAttribute[];
  size?: string;         // legacy mirror of attributes[0]
  colour?: string;       // legacy mirror of attributes[1]
  expiryDate?: string;
  batchNo?: string;
}
```

Keep `size` and `colour` on `ProductVariant`. They are read by old code, the sync mapper and the backend.

---

## 5. File map

| File | Change | Slice |
|---|---|---|
| `mobile/src/core/types.ts` | `ProfileId`, `VariantAttribute`, new product/shop fields | 1–3 |
| `mobile/src/core/profiles.ts` | **new** profile config + helpers | 1 |
| `mobile/src/core/index.ts` | export profiles | 1 |
| `mobile/src/core/profiles.test.ts` | **new** config tests | 1 |
| `mobile/src/db/schema.ts` | v10, v11, v12 migrations | 1–3 |
| `mobile/src/db/repos.ts` | shop profile, product fields, multi-variant create, label helpers | 1–3 |
| `mobile/src/db/sync.ts` | map `profileId`, attributes, new product fields | 1–3 |
| `mobile/src/app/onboarding/shop.tsx` | 9-card profile picker | 1 |
| `mobile/src/app/settings.tsx` | profile picker, profile label | 1 |
| `mobile/src/app/product/new.tsx` | axis fields, category chips, unit/expiry/batch/warning, multi-variant rows | 1–3 |
| `mobile/src/app/product/[id].tsx` | variant labels, expiry/unit/warning display | 1–2 |
| `mobile/src/app/sale/new.tsx` | variant labels, warning/expiry confirm | 1–2 |
| `mobile/src/app/(tabs)/products.tsx` | category filter, expiry filter, service/sold states | 4 |
| `mobile/src/app/(tabs)/index.tsx` | expiring-soon card | 4 |
| `mobile/src/data/fake.ts` | `profileId` on the demo shop | 1 |
| `mobile/src/db/seed.ts` | insert `profile_id` | 1 |
| `mobile/src/i18n/en.json` | profile/field/expiry keys | 1–2 |
| `mobile/src/i18n/ny.json` | same keys (English fallback until reviewed) | 1–2 |
| `docs/sync-contract.md` | new payload fields | 1–3 |
| `backend/apps/sync/models.py` | `profile_id`, product/variant fields | 1–3 |
| `backend/apps/sync/services.py` | parse and store new fields | 1–3 |
| `backend/apps/sync/migrations/*` | generated migrations | 1–3 |
| `backend/apps/ussd/services.py` | exclude `track_stock=0`, label from attributes | 2–3 |
| `mobile/src/db/repos.integration.test.ts` | new fields + migration test | 1–3 |
| `mobile/src/db/sync.integration.test.ts` | payload round-trip | 1–3 |

---

## 6. Slice 1 — Profile layer (start here)

**Goal:** the app asks what kind of shop this is, and the product screens change their vocabulary. No new product fields yet. No sync contract change beyond an extra optional `profileId` that the backend can ignore.

**Time:** ~0.5–1 focused day.

### 6.1 Add the profile module

- Create `mobile/src/core/profiles.ts` from section 3.
- Add `export * from './profiles';` to `mobile/src/core/index.ts`.
- Create `mobile/src/core/profiles.test.ts` from section 3.4.

### 6.2 Update the domain types

In `mobile/src/core/types.ts`:

- Add `ProfileId`.
- Add `profileId: ProfileId` to `Shop`.
- Leave `ProductVariant` untouched in this slice.

### 6.3 Add the v10 migration

Append the SQL from section 4.1 to `mobile/src/db/schema.ts`. Do not edit earlier migrations.

### 6.4 Update the data layer

`mobile/src/db/repos.ts`:

1. `ShopRecord` gets `profileId: ProfileId`.
2. `getShop` selects `profile_id AS profileId` and falls back:

   ```ts
   profileId: profileForShop({ profileId: row.profileId, type: row.type as ShopType }).id,
   ```

3. `ShopDetailsInput` gets `profileId: ProfileId` (required, so no caller silently resets it).
4. `saveShopDetails` writes `profile_id` and the legacy `type`:

   ```ts
   const profile = PROFILE_BY_ID[input.profileId] ?? PROFILE_BY_ID.general;
   const legacyType = profile.legacyType;
   ```

   Use `legacyType` in the `UPDATE`/`INSERT` `type` column. Add `profile_id = ?` to both statements.
5. The outbox payload gets `profileId: input.profileId`. Keep `type: legacyType` for USSD and the backend.
6. `CreateProductInput` gets optional `size?: string` and `colour?: string`, and the `product_variant` insert writes them.

Import `PROFILE_BY_ID` / `profileForShop` from `@/core`.

`mobile/src/db/sync.ts`:

- In `mapShop`, add `profile_id: text(p.profileId ?? p.profile_id)`.
- No other change.

`mobile/src/data/fake.ts`:

- Add `profileId: 'fashion'` to the demo shop object.

`mobile/src/db/seed.ts`:

- Add `profile_id` to the `INSERT INTO shop` column list and values.

### 6.5 Onboarding shop screen

`mobile/src/app/onboarding/shop.tsx`:

- Replace the 4-item `SHOP_TYPES` array with `PROFILES`.
- State: `const [profileId, setProfileId] = useState<ProfileId>('fashion');`
- Hydrate from `profileForShop(shop).id`.
- Render `OptionCard` per profile, with `icon={profile.icon as AndroidSymbol}`.
- When the owner picks a profile, also set the barcode default:

  ```tsx
  onPress={() => {
    setProfileId(profile.id);
    setUsesBarcodes(profile.barcodesDefault);
  }}
  ```

- Pass `profileId` to `saveShopDetails`.
- Keep the existing "Does your shop use barcodes?" section; it is still an owner choice.

`OptionGrid` is two cards per row, so 9 profiles make a long but scrollable screen. That is acceptable. If Given wants a compact version, group them: "Clothing", "Health & beauty", "Food & drink", "Other".

### 6.6 Settings screen

`mobile/src/app/settings.tsx`:

- Replace `SHOP_TYPES` with `PROFILES`.
- State `profileId` instead of `shopType`.
- `startEditing` reads `profileForShop(shop).id`.
- `changeLanguage` and `saveEdits` pass `profileId: profileForShop(shop).id` / `profileId`.
- The read-only shop summary shows `t(profileForShop(shop).nameKey)`.
- Add a hint under the picker: changing profile changes labels and defaults, never existing products.

### 6.7 Product form

`mobile/src/app/product/new.tsx`:

- `const profile = profileForShop(shop);`
- State `const [attributes, setAttributes] = useState<Record<string, string>>({});`
- Render one block per `profile.axes`:

  ```tsx
  {profile.axes.map((axis) => (
    <View key={axis.key} style={styles.axis}>
      <Field
        label={t(axis.labelKey)}
        value={attributes[axis.key] ?? ''}
        onChangeText={(value) =>
          setAttributes((current) => ({ ...current, [axis.key]: value }))
        }
        placeholder={axis.placeholder}
        maxLength={axis.maxLength}
      />
      <View style={styles.chips}>
        {axis.quickPicks.map((pick) => (
          <Choice
            key={pick}
            label={pick}
            selected={attributes[axis.key] === pick}
            onPress={() =>
              setAttributes((current) => ({ ...current, [axis.key]: pick }))
            }
          />
        ))}
      </View>
    </View>
  ))}
  ```

- Replace the plain category field with chips from `profile.categories` plus the existing free-text field:

  ```tsx
  <View style={styles.chips}>
    {profile.categories.map((category) => (
      <Choice
        key={category}
        label={category}
        selected={category === categoryDraft}
        onPress={() => setCategoryDraft(category)}
      />
    ))}
  </View>
  <Field
    label={t('product.new.category')}
    value={categoryDraft}
    onChangeText={setCategoryDraft}
    placeholder={profile.categories[0]}
  />
  ```

- On save, map the first two axes to the legacy slots:

  ```ts
  const [first, second] = profile.axes.map(
    (axis) => attributes[axis.key]?.trim() || undefined
  );

  await createProduct(db, {
    // ...existing fields
    size: first,
    colour: second,
  });
  ```

- If `profile.uniqueItems` (salaula), default `quantity` to `'1'` and render the opening quantity field as a read-only "1 item". Full unique-item behaviour lands in Slice 4; this keeps the form honest now.

### 6.8 Variant labels

Replace the hand-built `[size, colour]` joins in:

- `mobile/src/app/sale/new.tsx` (two places)
- `mobile/src/app/product/[id].tsx` (two places)
- `mobile/src/data/fake.ts` (the low-stock label helper)
- `mobile/src/db/repos.ts` (the JS-side `variantLabel` in `findVariantByBarcode`)

with `variantLabel(product.name, variant)` from `@/core`. Leave the SQL `TRIM(p.name || ' ' || COALESCE(v.size...))` labels alone in this slice; Slice 3 updates them.

### 6.9 i18n

Add to `mobile/src/i18n/en.json` (and the same keys in `ny.json`; English fallback is acceptable until Henry reviews):

```json
"profile.fashion": "Clothing & footwear",
"profile.fashion.caption": "Dresses, shirts, chitenge, shoes",
"profile.salaula": "Salaula (second-hand)",
"profile.salaula.caption": "One-off pieces, priced individually",
"profile.health_beauty": "Health & beauty",
"profile.health_beauty.caption": "Cosmetics, pharmacy, personal care",
"profile.bar": "Bar & bottle store",
"profile.bar.caption": "Beer, spirits, soft drinks, snacks",
"profile.grocery": "Grocery & mini-mart",
"profile.grocery.caption": "Food, drinks, household goods",
"profile.hardware": "Hardware",
"profile.hardware.caption": "Tools, electrical, plumbing, paint",
"profile.electronics": "Electronics & accessories",
"profile.electronics.caption": "Phones, chargers, earphones, cables",
"profile.salon": "Salon & services",
"profile.salon.caption": "Hair, nails, barber, repairs",
"profile.general": "General goods",
"profile.general.caption": "Anything else you sell",
"field.size": "Size",
"field.colour": "Colour",
"field.variant": "Shade / strength",
"field.pack": "Pack",
"field.packSize": "Size / pack",
"field.unit": "Unit",
"field.storage": "Storage",
"settings.profileHint": "Changing this changes the labels and defaults. It does not change products you already added."
```

Keep the old `onboarding.shop.type.*` keys for one release; remove them only after the screens stop using them.

### 6.10 Tests to update

- `mobile/src/db/repos.integration.test.ts`: every `saveShopDetails` call gets a `profileId`; `getShop` expectations include it.
- `mobile/src/db/sync.integration.test.ts`: shop payloads may include `profileId`; assert it round-trips into `profile_id`.
- `mobile/src/system/shop-day.system.test.ts`: `saveShopDetails` call gets `profileId: 'fashion'`.
- `mobile/src/data/fake.test.ts`: the demo shop has a valid profile id.

### 6.11 Slice 1 acceptance

- [ ] Clothing onboarding and the demo path behave exactly as before.
- [ ] Picking "Health & beauty" shows "Shade / strength" and "Size / pack" in the product form, with the beauty categories.
- [ ] Picking "Bar" shows "Size / pack" and "Size"; picking "Electronics" shows "Storage" and "Colour".
- [ ] Picking "Salon" shows no variant fields.
- [ ] The profile survives an app restart and a Settings edit.
- [ ] The shop still syncs: `type` carries a legacy value, `profileId` is extra.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.
- [ ] No tax/reconciliation/USSD logic changed.

---

## 7. Slice 2 — Product fields

**Goal:** pharmacy, cosmetics, grocery and bars can record the fields they actually need: unit, expiry, batch and a sale warning. Old products keep working with defaults.

**Time:** ~0.5–1 focused day.

### 7.1 Migration and types

- Append the v11 SQL from section 4.2.
- Add the fields to `Product` and `ProductVariant` in `core/types.ts`.
- `Product.unit` defaults to `'piece'`; `trackStock` defaults to `true`.
- Update the demo products in `mobile/src/data/fake.ts` and any test fixtures with `unit: 'piece'` and `trackStock: true` so the required type compiles.

### 7.2 Data layer

`mobile/src/db/repos.ts`:

- `CreateProductInput` gets `unit?: string`, `trackStock?: boolean`, `saleWarning?: string`, `expiryDate?: string`, `batchNo?: string`.
- Insert them in `createProduct`.
- `listProductsWithStock` selects `unit`, `track_stock AS trackStock`, `sale_warning AS saleWarning`, `expiry_date AS expiryDate`, `batch_no AS batchNo`.
- `ProductWithStock` and `VariantWithStock` carry them.
- `restockVariant` accepts optional `expiryDate` and `batchNo` and updates the variant.
- The outbox payloads include the new fields.

`mobile/src/db/sync.ts`:

- `mapProduct`: `unit`, `track_stock`, `sale_warning`.
- `mapVariant`: `expiry_date`, `batch_no`.

### 7.3 Product form

In `mobile/src/app/product/new.tsx`:

- Unit: a `Choice` row from `profile.units`, default `profile.defaultUnit`.
- Expiry: only if `profile.modules.includes('expiry')`. Plain `Field` with placeholder `YYYY-MM-DD`; validate with a real date check, not just a regex.
- Batch: only if `profile.modules.includes('batch')`. Plain `Field`.
- Sale warning: only if `profile.modules.includes('saleWarning')`. Choices: None, "Rx only", "18+", plus the existing free-text field if you want a custom value.
- `trackStock` defaults from `profile.trackStockDefault` (the salon profile turns it off).

### 7.4 Sale warning and expiry

`mobile/src/app/sale/new.tsx`:

- Before `recordSale`, collect warnings from the basket:
  - Any product with `saleWarning` → one confirm dialog listing the lines.
  - Any variant with `expiryDate` in the past → "Expired stock" in the same dialog.
- Use `Alert.alert` with "Cancel" and "Sell anyway". Do not block the sale; the owner is warned.
- Do not put this logic in `recordSale`; the repo stays pure.

### 7.5 Backend

`backend/apps/sync/models.py`:

```python
class Product(PhoneRecord):
    # ...existing
    unit = models.CharField(max_length=20, blank=True)
    track_stock = models.BooleanField(default=True)
    sale_warning = models.CharField(max_length=60, blank=True)

class ProductVariant(PhoneRecord):
    # ...existing
    expiry_date = models.DateField(null=True, blank=True)
    batch_no = models.CharField(max_length=60, blank=True)
```

`backend/apps/sync/services.py`:

- `_fill_product`: `unit` (max 20), `trackStock`/`track_stock` (bool), `saleWarning`/`sale_warning` (max 60).
- `_fill_variant`: `expiryDate`/`expiry_date` (ISO date or null), `batchNo`/`batch_no` (max 60).
- `_fill_shop`: `profileId`/`profile_id` (max 30). Add `profile_id` to the sync `Shop` model with default `"general"`.
- Generate migrations: `python manage.py makemigrations sync`.

Update `docs/sync-contract.md` rows for `shop`, `product` and `product_variant`.

`backend/apps/ussd/services.py`:

- `_low_stock`: exclude variants whose product has `track_stock=False`.

### 7.6 Slice 2 acceptance

- [ ] A pharmacy product can set expiry, batch, unit and "Rx only".
- [ ] Selling it shows one confirmation dialog, and cancel leaves the basket intact.
- [ ] An expired item is called out in the same dialog.
- [ ] Old products read back with `unit='piece'`, `trackStock=true`, no expiry.
- [ ] Backend sync round-trips all new fields.
- [ ] USSD stock check excludes services.
- [ ] Tests, typecheck and lint pass.

---

## 8. Slice 3 — Multi-variant editor

**Goal:** clothing, cosmetics, bars and electronics can add several variants under one product, each with its own price, stock, barcode and optional expiry/batch.

**Time:** ~1–1.5 focused days.

### 8.1 Migration and types

- Append the v12 SQL from section 4.3.
- Add `attributes: VariantAttribute[]` to `ProductVariant` and `VariantAttribute` to `core/types.ts`.
- Add `attributesOf()` and keep writing `size`/`colour` mirrors.

### 8.2 Data layer

`mobile/src/db/repos.ts`:

- Add:

  ```ts
  export interface VariantInput {
    attributes: VariantAttribute[];
    barcode?: string;
    buyPrice: Ngwee;
    sellPrice: Ngwee;
    openingQuantity: number;
    lowStockLevel?: number;
    expiryDate?: string;
    batchNo?: string;
  }

  export interface CreateProductWithVariantsInput {
    name: string;
    category?: string;
    photoUri?: string;
    unit?: string;
    trackStock?: boolean;
    saleWarning?: string;
    discount?: ProductDiscount;
    variants: VariantInput[];
  }
  ```

- Implement `createProductWithVariants(db, input)`:
  - Validate: at least one variant; trimmed attribute values; no duplicate attribute combinations (case-insensitive); unique barcodes within the input and against the DB; prices ≥ 0; quantities ≥ 0.
  - Insert one `product` row.
  - For each variant: auto-generate a barcode if none was given (preserve current `autoBarcode` behaviour), insert `product_variant` with `attributes_json`, `size` = first value, `colour` = second value, and the opening `stock_movement` when quantity > 0.
  - Enqueue one `product` sync item and one per variant.
  - Return `{ productId, variantIds }`.
- Keep `createProduct` as a thin wrapper that calls `createProductWithVariants` with one variant. This keeps onboarding and existing tests working.
- Update `listProductsWithStock` to parse `attributes_json` and return `attributes`.
- Update SQL labels (`lowStockVariants`, `findVariantByBarcode`, insights) to build labels in JS from attributes; do not try to parse JSON in SQL.

### 8.3 Product form

Replace the single "opening quantity" block with a variant list:

- `type DraftVariant = { attributes: Record<string, string>; barcode: string; buyPrice: string; sellPrice: string; quantity: string; lowStock: string; expiryDate: string; batchNo: string }`.
- Start with one row.
- Each row renders the profile axes, barcode (if used), buy/sell, opening quantity, low stock, and expiry/batch when enabled.
- "Add another {axis1 label}" duplicates the last row's prices and clears the attribute values.
- Remove row button, disabled when only one row remains.
- On save, validate duplicate attribute combinations and barcodes in the UI before calling the repo.
- For `profile.uniqueItems`, keep one row and force quantity `1` (Slice 4 completes the behaviour).

### 8.4 Product detail and sale

- Product detail: variant chips use `variantLabel('', variant)`; show unit, expiry and batch; restock updates expiry/batch.
- Sale: the product list and basket use `variantLabel(product.name, variant)`.
- Search already matches `size`/`colour`; add `attributes_json` values to the search haystack.

### 8.5 Backend

- `ProductVariant.attributes_json = models.JSONField(default=list)`.
- `_fill_variant`: parse `attributes` / `attributes_json`; validate a list of at most two `{key, value}` objects; mirror the first two values into `size`/`colour` when those are absent.
- Update `__str__` to use the attribute values when present.
- USSD stock list uses the same label logic.
- Update `docs/sync-contract.md`.

### 8.6 Slice 3 acceptance

- [ ] A bar product can have Bottle / Crate / Shot, each with its own price, stock and barcode.
- [ ] A cosmetics product can have three shades; selling one reduces only that variant.
- [ ] Duplicate attribute combinations are rejected with a clear message.
- [ ] Duplicate barcodes are rejected.
- [ ] Existing single-variant products still open, sell and restock.
- [ ] Sync round-trips `attributes_json`; old payloads without it still work.
- [ ] Tests, typecheck and lint pass.

---

## 9. Slice 4 — Module polish

**Goal:** the profiles feel finished: expiry alerts, category filters, service mode and salaula one-off mode.

**Time:** ~0.5–1 focused day.

### 9.1 Expiry alerts

Add a query:

```sql
SELECT v.id AS variantId, p.name AS productName, v.attributes_json, v.size, v.colour,
       v.expiry_date AS expiryDate, s.quantity
  FROM product_variant v
  JOIN product p ON p.id = v.product_id
  JOIN variant_stock s ON s.variant_id = v.id
 WHERE v.expiry_date IS NOT NULL
   AND date(v.expiry_date) <= date('now', '+30 days')
   AND s.quantity > 0
 ORDER BY v.expiry_date
```

- Home: an "Expiring soon" card, only when `profile.modules.includes('expiry')`.
- Products: an "Expiring" filter alongside All / Low / Out.
- Product detail: red badge when expired, amber when within 30 days.

### 9.2 Service mode

When `product.trackStock === false`:

- `createProduct` skips the opening stock movement.
- `recordSale` skips stock movements and the shortfall check.
- `maxSellable` returns a large number (e.g. 9999) so the stepper does not cap.
- `lowStockVariants` and the expiry query exclude the variant.
- Products list shows a "Service" pill instead of stock counts.
- USSD stock check excludes it.
- Sale lines still record quantity and prices, so profit and tax work.

### 9.3 Category filter

- Products screen: a horizontal chip row "All" + distinct categories from the shop's products.
- Keep the existing All / Low / Out counts.
- Search still matches name, category and barcodes.

### 9.4 Salaula unique-item mode

When `profile.uniqueItems`:

- Opening quantity is fixed at 1 and read-only.
- Hide the low-stock field.
- Sale caps the quantity at 1.
- Products list shows "Sold" when quantity ≤ 0, otherwise "1 available".
- No variants (the profile has no axes).

### 9.5 Slice 4 acceptance

- [ ] A pharmacy product expiring within 30 days appears on Home and under the "Expiring" filter.
- [ ] A salon service sells without creating a stock movement, and does not appear in low-stock alerts or USSD stock.
- [ ] The category filter narrows the product list.
- [ ] A salaula item starts at 1, sells once, then shows "Sold".
- [ ] Tests, typecheck and lint pass.

---

## 10. Backend summary

### 10.1 Sync models

`backend/apps/sync/models.py`:

```python
class Shop(PhoneRecord):
    # ...existing
    profile_id = models.CharField(max_length=30, default="general")

class Product(PhoneRecord):
    # ...existing
    unit = models.CharField(max_length=20, blank=True)
    track_stock = models.BooleanField(default=True)
    sale_warning = models.CharField(max_length=60, blank=True)

class ProductVariant(PhoneRecord):
    # ...existing
    attributes_json = models.JSONField(default=list)
    expiry_date = models.DateField(null=True, blank=True)
    batch_no = models.CharField(max_length=60, blank=True)
```

Generate migrations with `python manage.py makemigrations sync` and commit them.

### 10.2 Sync service rules

- Accept both camelCase (phone) and snake_case (older payloads).
- `attributes_json`: must be a list of at most two objects with string `key` and `value`; ignore malformed entries rather than failing the whole batch.
- `expiry_date`: accept `YYYY-MM-DD` or null; reject invalid dates with a clear `SyncError`.
- Mirror `attributes[0]` → `size` and `attributes[1]` → `colour` when the legacy fields are absent.
- Keep ignoring unknown fields so a newer phone can ship first.

### 10.3 USSD

`backend/apps/ussd/services.py`:

- `_low_stock`: filter `variant.product.track_stock=True`.
- Stock list label: product name + attribute values, falling back to `size`/`colour`.
- Today's total and tax estimate are unchanged.

### 10.4 Sync contract

Update `docs/sync-contract.md`:

| Entity | New fields |
|---|---|
| `shop` | `profile_id` (optional; defaults from `type`) |
| `product` | `unit`, `track_stock`, `sale_warning` |
| `product_variant` | `attributes_json`, `expiry_date`, `batch_no` |

---

## 11. i18n keys

Add to both `en.json` and `ny.json`. Nyanja may temporarily hold the English text; Henry reviews before the demo.

```json
"profile.fashion": "Clothing & footwear",
"profile.fashion.caption": "Dresses, shirts, chitenge, shoes",
"profile.salaula": "Salaula (second-hand)",
"profile.salaula.caption": "One-off pieces, priced individually",
"profile.health_beauty": "Health & beauty",
"profile.health_beauty.caption": "Cosmetics, pharmacy, personal care",
"profile.bar": "Bar & bottle store",
"profile.bar.caption": "Beer, spirits, soft drinks, snacks",
"profile.grocery": "Grocery & mini-mart",
"profile.grocery.caption": "Food, drinks, household goods",
"profile.hardware": "Hardware",
"profile.hardware.caption": "Tools, electrical, plumbing, paint",
"profile.electronics": "Electronics & accessories",
"profile.electronics.caption": "Phones, chargers, earphones, cables",
"profile.salon": "Salon & services",
"profile.salon.caption": "Hair, nails, barber, repairs",
"profile.general": "General goods",
"profile.general.caption": "Anything else you sell",
"field.size": "Size",
"field.colour": "Colour",
"field.variant": "Shade / strength",
"field.pack": "Pack",
"field.packSize": "Size / pack",
"field.unit": "Unit",
"field.storage": "Storage",
"product.new.unit": "Unit",
"product.new.expiry": "Expiry date",
"product.new.batch": "Batch number",
"product.new.saleWarning": "Sale warning",
"product.new.saleWarning.none": "None",
"product.new.saleWarning.rx": "Rx only",
"product.new.saleWarning.age": "18+",
"product.new.addVariant": "Add another {axis}",
"product.new.removeVariant": "Remove",
"sale.warning.title": "Check before selling",
"sale.warning.rx": "Prescription-only item. Confirm the customer has a prescription.",
"sale.warning.age": "Age-restricted item. Confirm the customer is 18 or older.",
"sale.warning.expired": "This stock has expired.",
"sale.warning.continue": "Sell anyway",
"products.filter.expiring": "Expiring",
"products.service": "Service",
"products.sold": "Sold",
"home.expiring.title": "Expiring soon",
"home.expiring.empty": "Nothing expiring in the next 30 days",
"settings.profile": "Shop profile",
"settings.profileHint": "Changing this changes the labels and defaults. It does not change products you already added."
```

---

## 12. Testing plan

### 12.1 Unit

- `mobile/src/core/profiles.test.ts` (new).
- `mobile/src/core/core.test.ts` / `edge-cases.test.ts` if pricing/stock behaviour changes.

### 12.2 Integration

- Migration test: open a v9 database with a shop, product and variant, run `initializeDatabase`, assert `profile_id` backfill and the new columns.
- Repo test: `saveShopDetails` round-trips `profileId`; `getShop` falls back for an old row.
- Product test: create a health & beauty product with expiry/batch/unit; read it back.
- Multi-variant test: create three variants; sell one; assert only that variant's stock falls; assert duplicate barcodes are rejected.
- Service test: create a `trackStock=false` product; sell it; assert no `stock_movement`.
- Sync test: push/pull a shop, product and variant with the new fields; assert round-trip; assert an old payload without them still applies.

### 12.3 System

- Update `mobile/src/system/shop-day.system.test.ts` to use `profileId: 'fashion'` and the new `createProduct` signature.

### 12.4 Manual QA matrix

For each demo profile (fashion, health & beauty, bar, salaula, salon, electronics):

1. Onboard and pick the profile.
2. Add a product with the profile's axes and optional fields.
3. Sell it in airplane mode.
4. Confirm stock, low-stock and expiry behaviour.
5. Restock.
6. Void the sale and confirm stock returns.
7. Reconcile the day.
8. Check the tax estimate.
9. Sync and confirm the payload in the backend admin.
10. Repeat in Nyanja.

### 12.5 Commands

```powershell
cd mobile
npm run typecheck
npm run lint
npm test

cd ..\backend
python manage.py test
```

or from the repo root:

```powershell
.\scripts\test.ps1
```

---

## 13. Demo script (3 minutes)

1. **Onboarding:** show the profile grid. Pick **Health & beauty**.
2. **Add a product:** "Nivea Sun SPF 50, 100 ml". Show the Shade/strength and Size/pack fields, the category chips, expiry and "Rx only" warning.
3. **Airplane mode:** sell it. Show the warning dialog, then stock falling.
4. **Switch profile:** Settings → **Bar & bottle store**. Add "Castle Lager" with Bottle / Crate / Shot variants, each with its own stock.
5. **Sell a crate.** Show the correct variant's stock drop.
6. **Salaula:** add a one-off item, sell it, show "Sold".
7. **Salon:** sell a service; show that stock is not affected.
8. **Reconcile and Tax:** show that the same reconciliation and 5% turnover-tax estimate still work across every profile.
9. **Close:** "One app. Any till. Same tax truth."

Keep the live demo to three trades. The rest are profile cards and slides.

---

## 14. Guardrails (do not build in this phase)

- Prescription dispensing, controlled-substance registers, age verification.
- Batch/lot tracking with FEFO. Expiry is per variant for now; true lot tracking is a later phase.
- Serial/IMEI and warranty tracking for electronics.
- Recipes / bill of materials for restaurants.
- Decimal quantities (weighed goods). Sell 500 g / 1 kg packs or whole metres.
- Supplier purchase orders, multi-shop, loyalty, receipt printing.
- Separate app builds per trade.

Add a visible line for pharmacy in the pitch and UI: **record-keeping and tax tool, not a dispensing system.**

---

## 15. Risks and open decisions

| Risk | Mitigation |
|---|---|
| Scope grows past the demo date | Ship Slice 1 first; every slice is independently demoable. |
| Migration breaks existing phones | Additive columns only; test v9 → v12; never edit a released migration. |
| Backend rejects new fields | Backend ignores unknown fields today; add support in Slice 2 before the mobile release that depends on it. |
| Sync loses attributes | Dual-write `attributes_json` and `size`/`colour`; test old payloads. |
| Nyanja labels missing | `t()` falls back to English; Henry reviews before the demo. |
| Pharmacy claims too strong | "Record-keeping only" disclaimer; no dispensing workflow. |
| 9 profile cards overwhelm onboarding | Group them if Given asks; the config stays the same. |
| Working tree has unrelated changes | Branch first; do not revert other people's work. |

**Open decisions:**

1. Do we need real batch/lot tracking for the pharmacy story, or is expiry-per-variant enough? (Recommended: expiry-per-variant for this phase.)
2. Do we demo salaula and electronics live, or only as profile cards? (Recommended: profile cards; live demo = fashion, health & beauty, bar.)
3. Who reviews the Nyanja labels? (Henry.)

---

## 16. Definition of done

- [ ] All Slice 1 acceptance criteria met.
- [ ] Slice 2 and 3 acceptance criteria met (Slice 4 if time allows).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.
- [ ] `python manage.py test` passes.
- [ ] `docs/sync-contract.md` updated.
- [ ] The demo script has a prepared product for each live demo trade (in the demo shop or on a second device).
- [ ] Nyanja labels reviewed.
- [ ] No change to tax, reconciliation or TaxPot calculations.
- [ ] The clothing demo path still works exactly as before.
