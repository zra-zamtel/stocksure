"""USSD data layer: reads the owner's synced records and applies the same rules as the app.

Rules mirrored from mobile/src/core: stock is the sum of stock movements (stock.ts); the tax estimate is
turnover x rate while turnover is under the threshold (tax.ts, estimateTurnoverTax). Menus live in menus.py.
"""
import math
import uuid
from datetime import date

from django.db import transaction
from django.db.models import Sum

from apps.configs.models import ConfigVersion
from apps.configs.validators import TAX_RULES
from apps.core.utils import day_bounds_utc, iso_now, lusaka_today
from apps.sync.models import SyncRecord
from apps.sync.services import Reject, apply_server_change

DEVICE_ID = "ussd"


class UssdError(Exception):
    """A problem to show the caller as plain text."""


def stock_by_variant(tenant_id):
    rows = (
        SyncRecord.objects.filter(tenant_id=tenant_id, entity="stock_movement")
        .values("ref_id").annotate(q=Sum("num")).values_list("ref_id", "q")
    )
    return {ref: (q or 0) for ref, q in rows}


def variants(tenant_id):
    """Every product variant with its label, price and quantity on hand, sorted by label."""
    products = {r.entity_id: r.data for r in SyncRecord.objects.filter(tenant_id=tenant_id, entity="product")}
    stock = stock_by_variant(tenant_id)
    out = []
    for rec in SyncRecord.objects.filter(tenant_id=tenant_id, entity="product_variant"):
        d = rec.data
        product = products.get(d["product_id"], {})
        parts = [product.get("name") or "Item", d.get("size"), d.get("colour")]
        out.append({
            "id": rec.entity_id,
            "label": " ".join(p for p in parts if p),
            "sell_price": d["sell_price"],
            "buy_price": d["buy_price"],
            "low_level": d.get("low_stock_level", 0),
            "stock": stock.get(rec.entity_id, 0),
        })
    return sorted(out, key=lambda v: v["label"].lower())


def today_summary(tenant_id):
    today = lusaka_today()
    lo, hi = day_bounds_utc(today, today)
    sales = SyncRecord.objects.filter(
        tenant_id=tenant_id, entity="sale", state="active", event_at__gte=lo, event_at__lt=hi
    )
    ids = list(sales.values_list("entity_id", flat=True))
    cash = mobile = 0
    for p in SyncRecord.objects.filter(tenant_id=tenant_id, entity="payment", ref_id__in=ids):
        if p.data["method"] == "cash":
            cash += p.data["amount"]
        else:
            mobile += p.data["amount"]
    total = sales.aggregate(t=Sum("num"))["t"] or 0
    return {"total": total, "count": len(ids), "cash": cash, "mobile": mobile}


def tax_estimate(tenant_id):
    """Returns None when no rules are published, {"no_period": True} before the app has made a tax period."""
    cfg = ConfigVersion.latest_published(TAX_RULES)
    if cfg is None:
        return None
    rules = cfg.payload
    periods = [r.data for r in SyncRecord.objects.filter(tenant_id=tenant_id, entity="tax_period")]
    if not periods:
        return {"no_period": True}
    today = lusaka_today().isoformat()
    covering = [p for p in periods if p["starts_on"] <= today <= p["ends_on"]]
    period = max(covering or periods, key=lambda p: p["starts_on"])  # same choice as the app
    lo, hi = day_bounds_utc(date.fromisoformat(period["starts_on"]), date.fromisoformat(period["ends_on"]))
    turnover = (
        SyncRecord.objects.filter(
            tenant_id=tenant_id, entity="sale", state="active", event_at__gte=lo, event_at__lt=hi
        ).aggregate(t=Sum("num"))["t"] or 0
    )
    eligible = 0 < turnover <= rules["threshold"]
    tax = math.floor(turnover * rules["rate"] + 0.5) if eligible else 0  # Math.round, as in tax.ts
    return {
        "turnover": turnover, "estimated_tax": tax, "eligible": eligible, "threshold": rules["threshold"],
        "due_on": period["due_on"], "rules_version": cfg.version, "validated_with_zra": cfg.validated_with_zra,
        "no_period": False,
    }


def record_sale(user, variant_id, quantity, method):
    """Save a USSD sale as the same four records the app would write, so it syncs down like any other.
    List price, no discounts. Stock cannot go below zero (the app's override needs a screen)."""
    tenant_id = user.tenant_id
    variant = next((v for v in variants(tenant_id) if v["id"] == variant_id), None)
    if variant is None:
        raise UssdError("That product was not found.")
    if quantity > variant["stock"]:
        raise UssdError(f"Only {variant['stock']} in stock.")
    now, uid = iso_now(), uuid.uuid4().hex[:16]
    total = variant["sell_price"] * quantity
    sale_id = f"ussd_sale_{uid}"
    base = {"created_at": now, "updated_at": now}
    records = [
        ("sale", {"id": sale_id, "recorded_by": user.app_id, "subtotal": total, "discount_total": 0, "total": total,
                  "status": "active", "void_reason": None, "reconcile_status": "unresolved", **base}),
        ("sale_line", {"id": f"ussd_line_{uid}", "sale_id": sale_id, "variant_id": variant_id, "quantity": quantity,
                       "buy_price": variant["buy_price"], "list_price": variant["sell_price"], "discount": 0,
                       "final_price": total, **base}),
        ("payment", {"id": f"ussd_pay_{uid}", "sale_id": sale_id, "method": method, "provider": None,
                     "amount": total, "mobile_money_reference": None, **base}),
        ("stock_movement", {"id": f"ussd_mov_{uid}", "variant_id": variant_id, "quantity_change": -quantity,
                            "reason": "sale", "note": "USSD sale", "sale_id": sale_id, **base}),
    ]
    try:
        with transaction.atomic():  # all four records or none
            for entity, payload in records:
                apply_server_change(user=user, entity=entity, payload=payload, device_id=DEVICE_ID)
    except Reject as reason:
        if "does not exist" in str(reason):
            raise UssdError("Your account has not synced yet. Open the app with internet first.")
        raise UssdError("The sale could not be saved.")
    return {"sale_id": sale_id, "total": total, "label": variant["label"]}
