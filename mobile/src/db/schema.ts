/**
 * Schema migrations. Index + 1 is the schema version stored in
 * `PRAGMA user_version`. Never edit a released migration: append a new one,
 * so an existing phone upgrades without losing sales.
 *
 * Money columns are INTEGER ngwee. Timestamps are ISO strings so they sort
 * correctly as text. IDs are generated on the phone.
 */

export const migrations: string[] = [
  // v1 - the thirteen record types from section 10 of the scope sheet
  `
  CREATE TABLE owner (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE staff (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE shop (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('clothes', 'shoes', 'general', 'other')),
    town TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ZMW' CHECK (currency = 'ZMW'),
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ny')),
    uses_barcodes INTEGER NOT NULL DEFAULT 0 CHECK (uses_barcodes IN (0, 1)),
    low_stock_default INTEGER NOT NULL DEFAULT 3,
    turnover_tax_registered INTEGER NOT NULL DEFAULT 0 CHECK (turnover_tax_registered IN (0, 1)),
    tpin TEXT,
    providers_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE product (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    photo_uri TEXT,
    default_buy_price INTEGER NOT NULL CHECK (default_buy_price >= 0),
    default_sell_price INTEGER NOT NULL CHECK (default_sell_price >= 0),
    discount_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE product_variant (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    size TEXT,
    colour TEXT,
    barcode TEXT,
    buy_price INTEGER NOT NULL CHECK (buy_price >= 0),
    sell_price INTEGER NOT NULL CHECK (sell_price >= 0),
    low_stock_level INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Barcodes must be unique across the shop, but a product without barcodes
  -- is allowed to have none at all, so the index is partial.
  CREATE UNIQUE INDEX idx_variant_barcode ON product_variant (barcode) WHERE barcode IS NOT NULL;
  CREATE INDEX idx_variant_product ON product_variant (product_id);

  CREATE TABLE stock_movement (
    id TEXT PRIMARY KEY NOT NULL,
    variant_id TEXT NOT NULL REFERENCES product_variant (id) ON DELETE RESTRICT,
    quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
    reason TEXT NOT NULL CHECK (reason IN ('opening', 'restock', 'sale', 'void', 'correction')),
    note TEXT,
    sale_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_movement_variant ON stock_movement (variant_id);
  CREATE INDEX idx_movement_sale ON stock_movement (sale_id);

  CREATE TABLE sale (
    id TEXT PRIMARY KEY NOT NULL,
    recorded_by TEXT NOT NULL,
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
    total INTEGER NOT NULL CHECK (total >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
    void_reason TEXT,
    reconcile_status TEXT NOT NULL DEFAULT 'unresolved'
      CHECK (reconcile_status IN ('matched', 'sale_no_payment', 'payment_no_sale', 'unresolved')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_sale_created ON sale (created_at);

  CREATE TABLE sale_line (
    id TEXT PRIMARY KEY NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sale (id) ON DELETE RESTRICT,
    variant_id TEXT NOT NULL REFERENCES product_variant (id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    buy_price INTEGER NOT NULL CHECK (buy_price >= 0),
    list_price INTEGER NOT NULL CHECK (list_price >= 0),
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    final_price INTEGER NOT NULL CHECK (final_price >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_line_sale ON sale_line (sale_id);

  CREATE TABLE payment (
    id TEXT PRIMARY KEY NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sale (id) ON DELETE RESTRICT,
    method TEXT NOT NULL CHECK (method IN ('cash', 'mobile_money')),
    provider TEXT CHECK (provider IN ('MTN', 'Airtel', 'Zamtel')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    mobile_money_reference TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_payment_sale ON payment (sale_id);

  CREATE TABLE mobile_money_txn (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('MTN', 'Airtel', 'Zamtel')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    sender TEXT,
    reference TEXT,
    received_at TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    parsed INTEGER NOT NULL DEFAULT 1 CHECK (parsed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_txn_reference ON mobile_money_txn (reference);

  CREATE TABLE reconciliation (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL UNIQUE,
    matched_count INTEGER NOT NULL DEFAULT 0,
    sale_no_payment_count INTEGER NOT NULL DEFAULT 0,
    payment_no_sale_count INTEGER NOT NULL DEFAULT 0,
    opening_float INTEGER NOT NULL DEFAULT 0,
    counted_cash INTEGER,
    expected_cash INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE tax_period (
    id TEXT PRIMARY KEY NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    turnover INTEGER NOT NULL DEFAULT 0,
    rate_used REAL NOT NULL,
    estimated_tax INTEGER NOT NULL DEFAULT 0,
    due_on TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE tax_pot_entry (
    id TEXT PRIMARY KEY NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('set_aside', 'top_up', 'paid')),
    period_id TEXT NOT NULL REFERENCES tax_period (id) ON DELETE RESTRICT,
    sale_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_pot_period ON tax_pot_entry (period_id);

  CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_queue_created ON sync_queue (created_at);

  -- Quantity on hand is always derived, never a column somebody can overwrite.
  CREATE VIEW variant_stock AS
  SELECT
    v.id AS variant_id,
    COALESCE(SUM(m.quantity_change), 0) AS quantity
  FROM product_variant v
  LEFT JOIN stock_movement m ON m.variant_id = v.id
  GROUP BY v.id;
  `,
];
