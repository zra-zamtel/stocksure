"""The sync contract in code (docs/sync-contract.md): which columns each record type has, what they
may contain, which ids must already exist, and which records may change after they are created.

The server checks SHAPE and REFERENCES only. It never recalculates prices, stock or tax.
To change the contract, edit ENTITIES below (and the doc)."""
import json
from dataclasses import dataclass, field

from apps.core.utils import parse_day, parse_iso


class Check:
    """A column check: calling it returns an error string, or None when the value is fine."""

    def __init__(self, fn, optional=False):
        self.fn = fn
        self.optional = optional

    def __call__(self, value):
        if value is None:
            return None if self.optional else "must not be null"
        return self.fn(value)


def _wrap(fn):
    def make(*args, optional=False, **kwargs):
        return Check(lambda v: fn(v, *args, **kwargs), optional=optional)
    return make


@_wrap
def text(v, max_len=2000, allow_empty=False):
    if not isinstance(v, str) or (not allow_empty and not v.strip()):
        return "must be a non-empty string"
    if len(v) > max_len:
        return f"is longer than {max_len} characters"
    return None


def otext(max_len=2000):
    """Optional text: may be missing, null or an empty string."""
    return text(max_len, allow_empty=True, optional=True)


@_wrap
def integer(v, min_value=0, nonzero=False):
    if isinstance(v, bool) or not isinstance(v, int):
        return "must be a whole number (money is integer ngwee)"
    if min_value is not None and v < min_value:
        return f"must be at least {min_value}"
    if nonzero and v == 0:
        return "must not be 0"
    return None


@_wrap
def number(v, min_value=0, max_value=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return "must be a number"
    if v < min_value or (max_value is not None and v > max_value):
        return "is out of range"
    return None


@_wrap
def enum(v, *allowed):
    if v not in allowed:
        return f"must be one of: {', '.join(allowed)}"
    return None


@_wrap
def flag(v):
    if isinstance(v, bool) or v not in (0, 1):
        return "must be 0 or 1"
    return None


@_wrap
def iso(v):
    return None if parse_iso(v) else "must be an ISO 8601 timestamp"


@_wrap
def day(v):
    return None if parse_day(v) else "must be a date as YYYY-MM-DD"


@_wrap
def json_text(v, kind=None):
    if not isinstance(v, str):
        return "must be a JSON string"
    try:
        parsed = json.loads(v)
    except ValueError:
        return "is not valid JSON"
    if kind is not None and not isinstance(parsed, kind):
        return f"must be a JSON {'array' if kind is list else 'object'}"
    return None


@dataclass
class Entity:
    rank: int                         # processing order inside a batch: parents before children
    fields: dict                      # column -> Check (the base id/created_at/updated_at are added)
    fks: dict = field(default_factory=dict)       # column -> entities it must point at (required)
    fks_optional: dict = field(default_factory=dict)  # column -> entities (may be null)
    immutable: bool = False           # rows are inserted once and never changed
    unique: str = ""                  # column that must be unique within the owner's data
    ref: str = ""                     # parent column stored in SyncRecord.ref_id
    num: str = ""                     # column stored in SyncRecord.num
    state: str = ""                   # column stored in SyncRecord.state
    staff_may_push: bool = False      # staff devices may create/update these
    locked_after_create: tuple = ()   # columns that cannot change once the row exists


BASE_FIELDS = {"id": text(80), "created_at": iso(), "updated_at": iso()}

ENTITIES = {
    "owner": Entity(rank=0, fields={"name": text(), "phone": text(20), "pin_hash": text()}, unique="singleton"),
    "staff": Entity(
        rank=1, unique="phone",
        fields={"name": text(), "phone": text(20), "pin_hash": text(), "role": enum("owner", "staff")},
    ),
    "shop": Entity(rank=2, fields={
        "name": text(), "type": enum("clothes", "shoes", "general", "other"), "town": text(),
        "currency": enum("ZMW"), "language": enum("en", "ny"), "uses_barcodes": flag(),
        "low_stock_default": integer(), "turnover_tax_registered": flag(),
        "tpin": otext(), "providers_json": json_text(list),
    }),
    "product": Entity(rank=3, fields={
        "name": text(), "category": otext(), "photo_uri": otext(),
        "default_buy_price": integer(), "default_sell_price": integer(),
        "discount_json": json_text(dict, optional=True),
    }),
    "product_variant": Entity(
        rank=4, unique="barcode", ref="product_id", fks={"product_id": ("product",)},
        fields={
            "product_id": text(80), "size": otext(), "colour": otext(),
            "barcode": otext(), "buy_price": integer(), "sell_price": integer(),
            "low_stock_level": integer(),
        },
    ),
    "sale": Entity(
        rank=5, num="total", state="status", staff_may_push=True,
        fks={"recorded_by": ("owner", "staff")},
        locked_after_create=("recorded_by", "subtotal", "discount_total", "total", "created_at"),
        fields={
            "recorded_by": text(80), "subtotal": integer(), "discount_total": integer(), "total": integer(),
            "status": enum("active", "void"), "void_reason": otext(),
            "reconcile_status": enum("matched", "sale_no_payment", "payment_no_sale", "unresolved"),
        },
    ),
    "sale_line": Entity(
        rank=6, immutable=True, ref="sale_id", num="final_price", staff_may_push=True,
        fks={"sale_id": ("sale",), "variant_id": ("product_variant",)},
        fields={
            "sale_id": text(80), "variant_id": text(80), "quantity": integer(min_value=1),
            "buy_price": integer(), "list_price": integer(), "discount": integer(), "final_price": integer(),
        },
    ),
    "payment": Entity(
        rank=7, immutable=True, ref="sale_id", num="amount", staff_may_push=True,
        fks={"sale_id": ("sale",)},
        fields={
            "sale_id": text(80), "method": enum("cash", "mobile_money"),
            "provider": enum("MTN", "Airtel", "Zamtel", optional=True), "amount": integer(),
            "mobile_money_reference": otext(),
        },
    ),
    "stock_movement": Entity(
        rank=8, immutable=True, ref="variant_id", num="quantity_change", staff_may_push=True,
        fks={"variant_id": ("product_variant",)}, fks_optional={"sale_id": ("sale",)},
        fields={
            "variant_id": text(80), "quantity_change": integer(min_value=None, nonzero=True),
            "reason": enum("opening", "restock", "sale", "void", "correction"),
            "note": otext(), "sale_id": otext(80),
        },
    ),
    "mobile_money_txn": Entity(rank=3, num="amount", staff_may_push=True, fields={
        "provider": enum("MTN", "Airtel", "Zamtel"), "amount": integer(), "sender": otext(),
        "reference": otext(), "received_at": iso(), "raw_message": text(10000, allow_empty=True),
        "parsed": flag(),
    }),
    "reconciliation": Entity(rank=3, unique="day", staff_may_push=True, fields={
        "day": day(), "matched_count": integer(), "sale_no_payment_count": integer(),
        "payment_no_sale_count": integer(), "opening_float": integer(),
        "counted_cash": integer(optional=True), "expected_cash": integer(), "note": otext(),
    }),
    "tax_period": Entity(rank=3, fields={
        "starts_on": day(), "ends_on": day(), "turnover": integer(), "rate_used": number(max_value=1),
        "estimated_tax": integer(), "due_on": day(), "paid": flag(),
    }),
    "tax_pot_entry": Entity(
        rank=9, immutable=True, ref="period_id", fks={"period_id": ("tax_period",)},
        fks_optional={"sale_id": ("sale",)},
        fields={
            "amount": integer(), "kind": enum("set_aside", "top_up", "paid"),
            "period_id": text(80), "sale_id": otext(80),
        },
    ),
}

# `sync_queue` is phone-only (see the contract) and is deliberately not an entity here.

# Staff devices: stock movements limited to sales; no voiding. Everything else is enforced in the app UI.
STAFF_STOCK_REASONS = ("sale",)


def column_names(entity: str):
    return set(BASE_FIELDS) | set(ENTITIES[entity].fields)


def validate_shape(entity: str, entity_id: str, payload: dict, strict: bool):
    """Return a list of human-readable problems (empty list = the payload is well formed)."""
    errors = []
    spec = ENTITIES[entity]
    for name, check in {**BASE_FIELDS, **spec.fields}.items():
        if name not in payload:
            if not check.optional:
                errors.append(f"{entity}.{name} is required")
            continue
        problem = check(payload[name])
        if problem:
            errors.append(f"{entity}.{name} {problem}")
    if strict:
        unknown = sorted(set(payload) - column_names(entity))
        if unknown:
            errors.append(f"{entity} has no column(s): {', '.join(unknown)}")
    if payload.get("id") != entity_id:
        errors.append("payload.id must equal entityId")
    return errors
