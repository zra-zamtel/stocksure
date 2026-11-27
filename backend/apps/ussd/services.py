"""USSD menu logic (Africa's Talking style). The gateway POSTs the caller's number and the full
dial-string so far in `text` ("1*150*1"), and expects "CON ..." (continue) or "END ..." (finish).
State lives in `text`, so the server keeps no session. The web USSD simulator calls the same endpoint.

USSD is the one place where the server writes shop data itself. It writes the
same `apps.sync` tables the phone uses, so a USSD sale appears in the app when
the phone pulls.
"""
import re
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.accounts.models import User
from apps.core.utils import local_today, month_bounds, normalize_phone
from apps.shops.selling import owner_may_record_sale
from apps.sync.models import (
    Payment,
    ProductVariant,
    Sale,
    Shop,
    SyncChange,
    TaxPeriod,
    TaxPotEntry,
)
from apps.sync.services import period_id_for, resolve_shop, tax_period_payload
from apps.tax.services import compute_estimate

MENU_OWNER_SOLO = (
    "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary\n"
    "4. Tax estimate\n5. Save to TaxPot"
)
# An owner with staff leaves selling to them, so this menu starts at 2.
MENU_OWNER = (
    "CON StockSure\n2. Check stock\n3. Today's summary\n"
    "4. Tax estimate\n5. Save to TaxPot"
)
MENU_ASSISTANT = "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary"


def _msg(exc):
    detail = exc.detail
    if isinstance(detail, dict):
        detail = next(iter(detail.values()))
    if isinstance(detail, list | tuple):
        detail = detail[0]
    return str(detail)


def _ngwee(raw):
    """USSD speaks Kwacha; storage is integer ngwee."""
    try:
        value = Decimal(raw)
    except (InvalidOperation, TypeError):
        return None
    if not (0 < value < Decimal(1000000)):
        return None
    return int((value * 100).quantize(Decimal(1)))


def _k(ngwee) -> str:
    return f"K{Decimal(ngwee) / 100:.2f}"


def _with_stock(shop):
    return (
        ProductVariant.objects.filter(shop=shop)
        .select_related("product")
        .annotate(stock=Coalesce(Sum("movements__quantity_change"), Value(0)))
    )


def _stock_label(variant, width=22):
    """One USSD line: product and its variant values, trimmed to fit the screen."""
    text = " ".join([variant.product.name, *variant.label_values])
    return text if len(text) <= width else text[: width - 3].rstrip() + "..."


def _low_stock(shop):
    variants = list(_with_stock(shop).order_by("stock", "product__name", "size", "id"))
    if not variants:
        return "END No products have synced yet. Add products in the app first."
    low = [variant for variant in variants if variant.stock <= variant.low_stock_level]
    if not low:
        return "END Stock OK: all items are above their low-stock level."
    out = sum(1 for variant in low if variant.stock <= 0)
    lines = [f"END Low stock {len(low)}/{len(variants)}, {out} out"]
    lines.extend(f"{_stock_label(variant)}: {variant.stock}" for variant in low[:4])
    if len(low) > 4:
        lines.append(f"+{len(low) - 4} more in the app")
    return "\n".join(lines)


def _stock_by_barcode(shop, barcode):
    code = (barcode or "").strip()
    if not code:
        return "END Enter a barcode."
    variant = _with_stock(shop).filter(barcode=code).first()
    if variant is None:
        return "END No item with that barcode."
    if variant.stock <= 0:
        note = " Out of stock."
    elif variant.stock <= variant.low_stock_level:
        note = " Low stock."
    else:
        note = ""
    return (
        f"END {_stock_label(variant, 30)}: {variant.stock} left "
        f"at {_k(variant.sell_price)}.{note}"
    )


def handle(phone, text):
    phone = normalize_phone(phone)
    parts = [part.strip() for part in (text or "").split("*")] if text else []
    user = User.objects.filter(phone=phone, is_active=True).first()
    try:
        if user is None:
            return _unregistered(phone, parts)
        shop = resolve_shop(user)
        if shop is None:
            return "END You are not linked to a shop. Ask the shop owner to add you."
        role = "owner" if shop.owner_id == user.id else "assistant"
        return _registered(user, shop, role, parts)
    except APIException as exc:
        return "END " + _msg(exc)


@transaction.atomic
def _unregistered(phone, parts):
    if not parts:
        return "CON Welcome to StockSure\n1. Register my shop"
    if parts[0] != "1":
        return "END Invalid choice."
    if len(parts) == 1:
        return "CON Enter your shop name"
    if len(parts) == 2:
        return "CON Choose a 4-digit PIN"
    name, pin = parts[1][:150], parts[2]
    if not name:
        return "END Shop name is required."
    if not re.fullmatch(r"\d{4}", pin):
        return "END PIN must be 4 digits. Please dial again."

    now = timezone.now()
    user = User.objects.create_user(phone=phone, password=pin, full_name="Shop owner")
    Shop.objects.create(
        id=f"shop_{uuid.uuid4().hex}",
        owner=user,
        name=name,
        type="other",
        town="",
        currency="ZMW",
        language="en",
        created_at=now,
        updated_at=now,
    )
    return f"END {name} is registered. Dial again to record your first sale."


def _month_start_end(today):
    return month_bounds(today.year, today.month)


def _period(shop, today):
    """The shop's tax period for this month, shared with the phone.

    The id is the same one the phone uses (tax_<shopId>_<YYYY-MM>), so a USSD
    TaxPot top-up and the phone's period are one row, and the rate is stored as
    a fraction (0.05), like the phone's rules file.
    """
    start, end = _month_start_end(today)
    period = TaxPeriod.objects.filter(
        shop=shop, starts_on__lte=today, ends_on__gte=today
    ).first()
    if period:
        return period

    result = compute_estimate(shop, start, end)
    now = timezone.now()
    period = TaxPeriod.objects.create(
        id=period_id_for(shop, start),
        shop=shop,
        starts_on=start,
        ends_on=end,
        turnover=int(result["basis_income"] * 100),
        rate_used=result["rate_percent"] / Decimal(100),
        estimated_tax=int(result["estimated_tax"] * 100),
        due_on=end + timedelta(days=14),
        paid=False,
        created_at=now,
        updated_at=now,
    )
    SyncChange.objects.create(
        shop=shop,
        entity="tax_period",
        entity_id=period.id,
        operation="create",
        payload=tax_period_payload(period),
        client_created_at=now,
    )
    return period


def _registered(user, shop, role, parts):
    is_owner = role == "owner"
    if not parts:
        if not is_owner:
            return MENU_ASSISTANT
        return MENU_OWNER_SOLO if owner_may_record_sale(user) else MENU_OWNER
    choice = parts[0]

    if choice == "1" and is_owner and not owner_may_record_sale(user):
        return "END Only staff record sales. Ask your staff to record it."
    if choice == "1":  # record a sale
        if len(parts) == 1:
            return "CON Enter sale amount in Kwacha"
        amount = _ngwee(parts[1])
        if amount is None:
            return "END Invalid amount. Please dial again."
        if len(parts) == 2:
            return f"CON Sale {_k(amount)}. Paid by:\n1. Cash\n2. Mobile money"
        method = {"1": Payment.Method.CASH, "2": Payment.Method.MOBILE_MONEY}.get(parts[2])
        if method is None:
            return "END Invalid choice. Please dial again."

        now = timezone.now()
        sale = Sale.objects.create(
            id=f"sale_{uuid.uuid4().hex}",
            shop=shop,
            recorded_by=user,
            subtotal=amount,
            discount_total=0,
            total=amount,
            status=Sale.Status.ACTIVE,
            reconcile_status=Sale.Reconcile.UNRESOLVED,
            created_at=now,
            updated_at=now,
        )
        payment = Payment.objects.create(
            id=f"pay_{uuid.uuid4().hex}",
            shop=shop,
            sale=sale,
            method=method,
            amount=amount,
            created_at=now,
            updated_at=now,
        )
        SyncChange.objects.create(
            shop=shop,
            entity="sale",
            entity_id=sale.id,
            operation="create",
            payload={
                "sale": {
                    "id": sale.id,
                    "recordedBy": str(user.id),
                    "subtotal": sale.subtotal,
                    "discountTotal": sale.discount_total,
                    "total": sale.total,
                    "status": sale.status,
                    "reconcileStatus": sale.reconcile_status,
                    "createdAt": now.isoformat(),
                    "updatedAt": now.isoformat(),
                },
                "lines": [],
                "payments": [
                    {
                        "id": payment.id,
                        "saleId": sale.id,
                        "method": payment.method,
                        "amount": payment.amount,
                        "createdAt": now.isoformat(),
                        "updatedAt": now.isoformat(),
                    }
                ],
                "stockMovements": [],
            },
            client_created_at=now,
        )
        label = "Cash" if method == Payment.Method.CASH else "Mobile money"
        from apps.smartinvoice.services import send_sale

        transaction.on_commit(lambda: send_sale(sale))
        return f"END Sale of {_k(amount)} recorded ({label})."

    if choice == "2":  # check stock
        if len(parts) == 1:
            return "CON Check stock\n1. Low stock\n2. Find by barcode"
        if parts[1] == "1":
            return _low_stock(shop)
        if parts[1] == "2":
            if len(parts) == 2:
                return "CON Enter the item barcode"
            return _stock_by_barcode(shop, parts[2])
        return "END Invalid choice. Please dial again."

    if choice == "3":  # today's summary
        today = local_today()
        sales = list(
            Sale.objects.filter(
                shop=shop, status=Sale.Status.ACTIVE, created_at__date=today
            )
        )
        payments = list(
            Payment.objects.filter(
                shop=shop,
                sale__status=Sale.Status.ACTIVE,
                sale__created_at__date=today,
            )
        )
        cash = sum(p.amount for p in payments if p.method == Payment.Method.CASH)
        mobile = sum(p.amount for p in payments if p.method == Payment.Method.MOBILE_MONEY)
        total = sum(s.total for s in sales)
        return (
            f"END Today: {_k(total)} from {len(sales)} sales.\n"
            f"Cash {_k(cash)}, mobile money {_k(mobile)}."
        )

    if choice in ("4", "5") and not is_owner:
        return "END This option is for the shop owner."

    if choice == "4":  # tax estimate for this month
        today = local_today()
        start, end = _month_start_end(today)
        result = compute_estimate(shop, start, end)
        if result["income_tax"]:
            return (
                "END Sales this year are K5,000,000 or more. "
                "Income tax applies, not turnover tax. Speak to ZRA."
            )
        estimated = int(result["estimated_tax"] * 100)
        basis = int(result["basis_income"] * 100)
        extra = "\nRules not yet validated with ZRA." if not result["rules_validated"] else ""
        return (
            f"END Estimated tax this month: {_k(estimated)} "
            f"(on {_k(basis)} sales). Estimate only, not a ZRA assessment.{extra}"
        )

    if choice == "5":  # simulated TaxPot contribution
        if len(parts) == 1:
            return "CON Amount to save in Kwacha (simulated)"
        amount = _ngwee(parts[1])
        if amount is None:
            return "END Invalid amount. Please dial again."
        if len(parts) == 2:
            return f"CON Save {_k(amount)}. Enter your StockSure password (your PIN if you registered by USSD)"
        if not user.check_password(parts[2]):
            return "END That password is not correct."

        now = timezone.now()
        period = _period(shop, local_today())
        entry = TaxPotEntry.objects.create(
            id=f"pot_{uuid.uuid4().hex}",
            shop=shop,
            amount=amount,
            kind=TaxPotEntry.Kind.TOP_UP,
            period=period,
            created_at=now,
            updated_at=now,
        )
        SyncChange.objects.create(
            shop=shop,
            entity="tax_pot_entry",
            entity_id=entry.id,
            operation="create",
            payload={
                "id": entry.id,
                "amount": entry.amount,
                "kind": entry.kind,
                "periodId": period.id,
                "saleId": entry.sale_id,
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
            },
            client_created_at=now,
        )
        entries = TaxPotEntry.objects.filter(shop=shop)
        saved = sum(
            entry.amount
            for entry in entries
            if entry.kind in (TaxPotEntry.Kind.SET_ASIDE, TaxPotEntry.Kind.TOP_UP)
        ) - sum(entry.amount for entry in entries if entry.kind == TaxPotEntry.Kind.PAID)
        return f"END Saved {_k(amount)} to TaxPot (simulated, no real money moved). Balance {_k(saved)}."

    return "END Invalid choice."
