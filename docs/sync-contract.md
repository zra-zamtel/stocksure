# Sync contract (phone <-> backend)

Working draft for Tabo. The phone owns the data; the backend stores and validates
it. The phone never asks the server to price a sale or move stock.

## Envelope

`POST /api/v1/sync/push`

```json
{
  "deviceId": "dev_abc123",
  "batchId": "batch_01",
  "changes": [
    {
      "queueId": "q1_...",
      "entity": "sale",
      "entityId": "sale_...",
      "operation": "create",
      "payload": { "...": "row as stored on the phone" },
      "clientCreatedAt": "2026-11-17T09:15:00Z",
      "attempts": 0
    }
  ]
}
```

Response:

```json
{
  "accepted": ["q1_..."],
  "rejected": [{ "queueId": "q2_...", "reason": "sale_line.variant_id does not exist" }],
  "serverTime": "2026-11-17T09:16:02Z",
  "cursor": "c_000042"
}
```

`GET /api/v1/sync/pull?cursor=c_000042&limit=500` returns the same shape plus
`nextCursor`. A fresh phone pulls from `cursor=0`.

## Rules

- **IDs come from the phone.** The server upserts on the primary key, so a
  replayed batch is a no-op. Do not generate IDs server-side.
- **Stock is append-only.** `stock_movement` rows are inserted, never updated
  or deleted, so two phones cannot overwrite each other's counts.
- **Nothing is deleted.** Voiding a sale is an update to `status` plus new
  `stock_movement` rows. `shop`, `product` and `product_variant` updates are
  partial: the payload carries only the fields that changed (a restock sends
  the new `buyPrice`, `expiryDate` or `batchNo`), and every field it leaves out
  keeps its stored value.
- **Unknown fields are ignored**, so a newer phone can ship before the server
  knows a field.
- **Reject, do not repair.** A malformed record is returned in `rejected` with a
  reason; the phone keeps it queued and shows it as unsynced.
- **Server does not recompute money.** It validates shape and foreign keys, and
  stores what the phone calculated. The one exception is USSD (#25), which runs
  the same rules server-side.

## Tables

Money is an integer number of ngwee. Timestamps are ISO 8601 text.
Every table has `id`, `created_at`, `updated_at`.

| Table | Columns |
| --- | --- |
| `owner` | name, phone (unique), email (unique), password_hash, pin_hash |
| `staff` | name, phone (unique), pin_hash, role (`owner` \| `staff`) |
| `shop` | name, type (legacy: `clothes` \| `shoes` \| `general` \| `other`), profile_id, town, currency (`ZMW`), language (`en` \| `ny`), uses_barcodes (0/1), low_stock_default, turnover_tax_registered (0/1), tpin, providers_json |
| `product` | name, category, photo_uri, default_buy_price, default_sell_price, discount_json, unit, sale_warning |
| `product_variant` | product_id, size, colour, barcode (unique when set), buy_price, sell_price, low_stock_level, expiry_date, batch_no |
| `stock_movement` | variant_id, quantity_change (never 0), reason (`opening` \| `restock` \| `sale` \| `void` \| `correction`), note, sale_id |
| `sale` | recorded_by, subtotal, discount_total, total, status (`active` \| `void`), void_reason, reconcile_status |
| `sale_line` | sale_id, variant_id, quantity, buy_price, list_price, discount, final_price |
| `payment` | sale_id, method (`cash` \| `mobile_money`), provider, amount, mobile_money_reference, confirmed_at, matched_txn_id |
| `mobile_money_txn` | provider, amount, sender, reference, received_at, raw_message, parsed (0/1) |
| `reconciliation` | day (unique), matched_count, sale_no_payment_count, payment_no_sale_count, opening_float, counted_cash, expected_cash, note |
| `tax_period` | starts_on, ends_on, turnover, rate_used, estimated_tax, due_on, paid (0/1) |
| `tax_pot_entry` | amount, kind (`set_aside` \| `top_up` \| `paid`), period_id, sale_id |
| `sync_queue` | entity, entity_id, operation, payload, attempts |

`sync_queue` is phone-only and is not part of the push payload's table set.

Shop profile and product fields (shop profiles, slices 1 and 2):

- `shop.profile_id` is the trade (`fashion`, `salaula`, `health_beauty`, `bar`,
  `grocery`, `electronics`, `general`; free text, so a new
  trade needs no migration). Optional: when it is missing, `clothes`/`shoes`
  read as `fashion` and anything else as `general`. `type` is still sent as
  the legacy mirror for USSD.
- `product.unit` is how the item is counted (`piece`, `bottle`, `strip`,
  `kg`...); empty reads as `piece`. `sale_warning` (`Rx only`, `18+`) is
  confirmed on the phone before a sale.
- `product_variant.expiry_date` is `YYYY-MM-DD` or null; an impossible date is
  rejected. `batch_no` is free text (60 characters).
- Payloads accept both camelCase (`profileId`, `saleWarning`,
  `expiryDate`, `batchNo`) and snake_case.

## Derived, never synced

`variant_stock` is a view: `SUM(stock_movement.quantity_change)` per variant.
The server can build the same view; do not send a quantity column.

## Still missing

`tax_rules` is not in this contract. Today it is a bundled JSON file in
`mobile/src/data/fake.ts` (`taxRules`). It should become a versioned config
endpoint that the app pulls, not a synced record.
