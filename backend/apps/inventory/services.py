import re
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.exceptions import Conflict

from .models import InvoiceScan, Item, StockMovement, StockTake, StockTakeLine


@transaction.atomic
def apply_movement(*, item_id, change, kind, user=None, reference="", note=""):
    """The ONLY way item quantity changes. Locks the row so two phones selling the last pair
    at the same moment cannot both read the same balance."""
    item = Item.objects.select_for_update().get(pk=item_id)
    item.quantity += change
    item.save(update_fields=["quantity", "updated_at"])
    return StockMovement.objects.create(
        shop_id=item.shop_id, item=item, kind=kind, quantity_change=change,
        balance_after=item.quantity, reference=reference, note=note, created_by=user,
    )


def expand_sizes(value):
    """'40-44' -> ['40','41','42','43','44'];  '40,42,44' -> [...];  ['S','M'] -> ['S','M']."""
    if isinstance(value, list | tuple):
        return [str(v).strip() for v in value if str(v).strip()]
    value = str(value or "").strip()
    if not value:
        return [""]
    parts = [p.strip() for p in value.split(",") if p.strip()]
    sizes = []
    for part in parts:
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            if lo > hi or hi - lo > 60:
                raise ValidationError({"sizes": f"Invalid size range '{part}'."})
            sizes.extend(str(n) for n in range(lo, hi + 1))
        else:
            sizes.append(part)
    return sizes


@transaction.atomic
def bulk_create_items(*, shop, user, name, category, color, price, cost_price, sizes, quantity_each, kind):
    """"Men's sneakers, black, sizes 40-44, 3 pairs each" as one entry instead of fifteen."""
    created = []
    for size in expand_sizes(sizes):
        item = Item.objects.filter(shop=shop, name=name, size=size, color=color).first()
        if item is None:
            item = Item.objects.create(
                shop=shop, name=name, size=size, color=color,
                category=category, price=price, cost_price=cost_price,
            )
        elif not item.is_active:
            item.is_active = True
            item.save(update_fields=["is_active", "updated_at"])
        if quantity_each:
            apply_movement(item_id=item.id, change=quantity_each, kind=kind, user=user, note="Bulk entry")
        item.refresh_from_db()
        created.append(item)
    return created


def find_item_by_code(shop, code):
    code = (code or "").strip()
    if not code:
        return None
    return (
        Item.objects.filter(shop=shop, is_active=True)
        .filter(label_code__iexact=code)
        .first()
        or Item.objects.filter(shop=shop, is_active=True, barcode=code).first()
    )


# ---- supplier invoice ---------------------------------------------------------------
def suggest_match(shop, row):
    """Match an invoice row to an existing item (same name, size, colour) so it is restocked."""
    return Item.objects.filter(
        shop=shop, is_active=True, name__iexact=row.get("name", ""),
        size__iexact=row.get("size") or "", color__iexact=row.get("color") or "",
    ).first()


@transaction.atomic
def confirm_invoice(*, scan, rows, user):
    if scan.status == InvoiceScan.Status.CONFIRMED:
        raise Conflict("This invoice has already been added to stock.")
    results = []
    for row in rows:
        qty = row["quantity"]
        item = None
        if row.get("item_id"):
            item = Item.objects.filter(shop=scan.shop, pk=row["item_id"]).first()
            if item is None:
                raise ValidationError({"items": f"Item {row['item_id']} not found in this shop."})
        else:
            item = suggest_match(scan.shop, row)
        created = False
        if item is None:
            if not row.get("price"):
                raise ValidationError({"items": f"A selling price is needed for new item '{row['name']}'."})
            item = Item.objects.create(
                shop=scan.shop, name=row["name"], category=row.get("category") or "",
                size=row.get("size") or "", color=row.get("color") or "",
                price=row["price"], cost_price=row.get("unit_cost"),
            )
            created = True
        apply_movement(
            item_id=item.id, change=qty, kind=StockMovement.Kind.DELIVERY, user=user,
            reference=f"invoice:{scan.id}",
        )
        results.append({"item_id": item.id, "name": item.display_name, "added": qty, "new_item": created})
    scan.status = InvoiceScan.Status.CONFIRMED
    scan.confirmed_at = timezone.now()
    scan.save(update_fields=["status", "confirmed_at", "updated_at"])
    return results


# ---- stock-taking -----------------------------------------------------------------
@transaction.atomic
def start_stock_take(*, shop, user, note=""):
    if StockTake.objects.filter(shop=shop, status=StockTake.Status.OPEN).exists():
        raise Conflict("A stock-take is already in progress for this shop.")
    take = StockTake.objects.create(shop=shop, started_by=user, note=note)
    StockTakeLine.objects.bulk_create(
        StockTakeLine(stock_take=take, item=i, expected_qty=i.quantity)
        for i in Item.objects.filter(shop=shop, is_active=True)
    )
    return take


def require_open(take):
    if take.status != StockTake.Status.OPEN:
        raise Conflict("This stock-take is closed.")


def build_report(take):
    """Exactly which items are missing (or extra), and what the shortfall is worth."""
    lines = list(take.lines.select_related("item"))
    missing, extra, uncounted = [], [], []
    missing_value = Decimal(0)
    for ln in lines:
        item = ln.item
        row = {
            "item_id": item.id, "name": item.display_name, "label_code": item.label_code,
            "expected": ln.expected_qty, "counted": ln.counted_qty,
            "activity_during_count": item.quantity != ln.expected_qty,
        }
        if ln.counted_qty is None:
            uncounted.append(row)
            continue
        diff = ln.counted_qty - ln.expected_qty
        row["difference"] = diff
        if diff < 0:
            row["value"] = str(item.price * abs(diff))
            missing_value += item.price * abs(diff)
            missing.append(row)
        elif diff > 0:
            extra.append(row)
    return {
        "missing": missing, "extra": extra, "not_counted": uncounted,
        "missing_units": sum(-r["difference"] for r in missing),
        "missing_value": str(missing_value),
        "lines_total": len(lines), "lines_counted": len(lines) - len(uncounted),
    }


@transaction.atomic
def close_stock_take(*, take, user, apply_adjustments=False):
    require_open(take)
    report = build_report(take)
    if apply_adjustments:
        for ln in take.lines.select_related("item"):
            if ln.counted_qty is not None and ln.counted_qty != ln.expected_qty:
                apply_movement(
                    item_id=ln.item_id, change=ln.counted_qty - ln.expected_qty,
                    kind=StockMovement.Kind.STOCKTAKE, user=user, reference=f"stocktake:{take.id}",
                )
    take.status = StockTake.Status.CLOSED
    take.closed_at = timezone.now()
    take.adjustments_applied = apply_adjustments
    take.summary = {k: report[k] for k in ("missing_units", "missing_value", "lines_total", "lines_counted")}
    take.save()
    if report["missing_units"]:
        from apps.notifications.models import Notification
        from apps.notifications.services import notify_owner

        names = ", ".join(f"{r['name']} x{-r['difference']}" for r in report["missing"][:3])
        notify_owner(
            take.shop, Notification.Kind.STOCK_SHORTAGE,
            f"StockSure: stock-take at {take.shop.name} found {report['missing_units']} item(s) missing "
            f"(K{Decimal(report['missing_value']):.2f}): {names}.",
        )
    return report
