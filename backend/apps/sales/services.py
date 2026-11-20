import uuid
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.exceptions import Conflict
from apps.core.utils import local_date, money
from apps.inventory.models import Item, StockMovement
from apps.inventory.services import apply_movement
from apps.ledger import services as ledger
from apps.reconciliation.models import DailyClose

from . import matching
from .models import MobilePayment, Sale, SaleLine


def _ensure_day_open(shop, date):
    if DailyClose.objects.filter(shop=shop, date=date).exists():
        raise Conflict(
            f"{date:%d %b %Y} has already been closed. Ask the owner to reopen the day to change its sales."
        )


@transaction.atomic
def record_sale(*, shop, user, role, payment_method, lines=None, amount=None, client_id=None,
                sold_at=None, payer_phone="", payment_reference="", note="", allow_amount_only=False,
                allow_oversell=False, provider=""):
    """Record one sale: stock out, ledger in, and (for mobile money) try to match the payment.

    Returns (sale, created, warnings). Safe to retry: the same client_id returns the first sale.
    Selling past the recorded quantity needs the owner's explicit approval, matching the
    phone's override prompt; an assistant cannot approve it.
    """
    if client_id:
        existing = Sale.objects.filter(shop=shop, client_id=client_id).first()
        if existing:
            return existing, False, []

    now = timezone.now()
    sold_at = sold_at or now
    if sold_at > now + timedelta(minutes=10):
        raise ValidationError({"sold_at": "A sale cannot be dated in the future."})
    sale_date = local_date(sold_at)
    _ensure_day_open(shop, sale_date)

    warnings = []
    prepared = []  # (item_or_None, description, qty, unit_price, line_total)
    if lines:
        item_ids = sorted({ln["item"] for ln in lines if ln.get("item")})
        items = {i.id: i for i in Item.objects.filter(shop=shop, is_active=True, id__in=item_ids)}
        for ln in lines:
            qty = ln["quantity"]
            item = None
            if ln.get("item"):
                item = items.get(ln["item"])
                if item is None:
                    raise ValidationError({"lines": f"Item {ln['item']} is not in this shop's stock."})
                price = item.price
                # Only the owner may sell at a different price than the register.
                if ln.get("unit_price") is not None and role == "owner":
                    price = ln["unit_price"]
                description = item.display_name
            else:
                if shop.is_full:
                    raise ValidationError({"lines": "In Full mode every line must be a stock item."})
                if ln.get("unit_price") is None:
                    raise ValidationError({"lines": "Each line needs an item or a unit price."})
                price = ln["unit_price"]
                description = ln.get("description", "")
            prepared.append((item, description, qty, price, money(Decimal(price) * qty)))
        total = sum((p[4] for p in prepared), Decimal("0"))
    else:
        if amount is None:
            raise ValidationError({"amount": "Send either 'lines' or an 'amount'."})
        if shop.is_full and not allow_amount_only:
            raise ValidationError({"lines": "In Full mode a sale needs stock items."})
        total = money(amount)
    if total <= 0:
        raise ValidationError({"total": "The sale total must be more than zero."})

    sale = Sale.objects.create(
        shop=shop, client_id=client_id or uuid.uuid4(), recorded_by=user,
        payment_method=payment_method, provider=provider, total=total, sold_at=sold_at, sale_date=sale_date,
        match_status=(Sale.Match.PENDING if payment_method == Sale.Method.MOBILE_MONEY
                      else Sale.Match.NOT_APPLICABLE),
        payer_phone=payer_phone, payment_reference=payment_reference, note=note,
    )
    # Lock/deduct items in id order so concurrent sales cannot deadlock.
    for item, description, qty, price, line_total in sorted(prepared, key=lambda p: p[0].id if p[0] else 0):
        SaleLine.objects.create(
            sale=sale, item=item, description=description, quantity=qty, unit_price=price, line_total=line_total
        )
        if item:
            # Check the balance under the same row lock apply_movement uses, so
            # two concurrent phones cannot both pass the check.
            locked = Item.objects.select_for_update().get(pk=item.id)
            if locked.quantity < qty and (role != "owner" or not allow_oversell):
                raise ValidationError(
                    {"lines": f"Not enough stock for {item.display_name}: {locked.quantity} on hand, "
                              f"{qty} requested. The owner must approve an override."}
                )
            mv = apply_movement(
                item_id=item.id, change=-qty, kind=StockMovement.Kind.SALE, user=user, reference=f"sale:{sale.id}"
            )
            if mv.balance_after < 0:
                warnings.append(
                    f"{item.display_name}: the register showed less stock than sold "
                    f"(now {mv.balance_after}). Check deliveries and opening stock."
                )
    ledger.create_sale_entry(sale, user)
    matching.try_match_sale(sale)
    sale.refresh_from_db()
    return sale, True, warnings


@transaction.atomic
def void_sale(*, sale, user, reason):
    if sale.status == Sale.Status.VOIDED:
        raise Conflict("This sale is already voided.")
    _ensure_day_open(sale.shop, sale.sale_date)
    for line in sale.lines.select_related("item"):
        if line.item_id:
            apply_movement(
                item_id=line.item_id, change=line.quantity, kind=StockMovement.Kind.SALE_VOID,
                user=user, reference=f"sale:{sale.id}", note=reason,
            )
    sale.status = Sale.Status.VOIDED
    sale.voided_at = timezone.now()
    sale.voided_by = user
    sale.void_reason = reason
    sale.save(update_fields=["status", "voided_at", "voided_by", "void_reason", "updated_at"])
    ledger.void_sale_entry(sale)
    MobilePayment.objects.filter(sale=sale).update(sale=None, status=MobilePayment.Status.UNMATCHED)
    return sale


@transaction.atomic
def register_payment(*, shop, reference, amount, payer_phone="", received_at=None, source, provider=""):
    """Idempotent on (shop, reference): Zamtel may retry the same notification."""
    payment, created = MobilePayment.objects.get_or_create(
        shop=shop, provider_ref=reference,
        defaults={
            "amount": money(amount), "provider": provider, "payer_phone": payer_phone,
            "received_at": received_at or timezone.now(), "source": source,
        },
    )
    if created:
        matching.try_match_payment(payment)
        payment.refresh_from_db()
    return payment, created
