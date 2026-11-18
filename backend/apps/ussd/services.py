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
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.accounts.models import User
from apps.core.utils import local_today, month_bounds, normalize_phone
from apps.sync.models import Payment, Sale, Shop, SyncChange, TaxPeriod, TaxPotEntry
from apps.sync.services import resolve_shop
from apps.tax.models import TaxRuleSet

MENU_OWNER = "CON StockSure\n1. Record a sale\n2. Today's summary\n3. Tax estimate\n4. Save to TaxPot"
MENU_ASSISTANT = "CON StockSure\n1. Record a sale\n2. Today's summary"


def _msg(exc):
    detail = exc.detail
    if isinstance(detail, dict):
        detail = next(iter(detail.values()))
    if isinstance(detail, (list, tuple)):
        detail = detail[0]
    return str(detail)


def _ngwee(raw):
    """USSD speaks Kwacha; storage is integer ngwee."""
    try:
        value = Decimal(raw)
    except (InvalidOperation, TypeError):
        return None
    if not (0 < value < Decimal("1000000")):
        return None
    return int((value * 100).quantize(Decimal("1")))


def _k(ngwee) -> str:
    return f"K{Decimal(ngwee) / 100:.2f}"


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


def _turnover(shop, start, end):
    return sum(
        sale.total
        for sale in Sale.objects.filter(
            shop=shop,
            status=Sale.Status.ACTIVE,
            created_at__date__gte=start,
            created_at__date__lte=end,
        )
    )


def _tax_rule():
    return TaxRuleSet.objects.filter(is_active=True).order_by("-version").first()


def _period(shop, today):
    start, end = _month_start_end(today)
    period = TaxPeriod.objects.filter(
        shop=shop, starts_on__lte=today, ends_on__gte=today
    ).first()
    if period:
        return period
    rule = _tax_rule()
    rate = rule.rate_percent if rule else Decimal("0")
    turnover = _turnover(shop, start, end)
    estimated = int(Decimal(turnover) * rate / Decimal("100"))
    now = timezone.now()
    period = TaxPeriod.objects.create(
        id=f"tax_{uuid.uuid4().hex}",
        shop=shop,
        starts_on=start,
        ends_on=end,
        turnover=turnover,
        rate_used=rate,
        estimated_tax=estimated,
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
        payload={
            "id": period.id,
            "startsOn": str(period.starts_on),
            "endsOn": str(period.ends_on),
            "turnover": period.turnover,
            "rateUsed": float(period.rate_used),
            "estimatedTax": period.estimated_tax,
            "dueOn": str(period.due_on),
            "paid": period.paid,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        },
        client_created_at=now,
    )
    return period


def _registered(user, shop, role, parts):
    is_owner = role == "owner"
    if not parts:
        return MENU_OWNER if is_owner else MENU_ASSISTANT
    choice = parts[0]

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
        return f"END Sale of {_k(amount)} recorded ({label})."

    if choice == "2":  # today's summary
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

    if choice in ("3", "4") and not is_owner:
        return "END This option is for the shop owner."

    if choice == "3":  # tax estimate for this month
        today = local_today()
        start, end = _month_start_end(today)
        rule = _tax_rule()
        if rule is None:
            return "END No tax rules are configured yet."
        turnover = _turnover(shop, start, end)
        estimated = int(Decimal(turnover) * rule.rate_percent / Decimal("100"))
        extra = "\nRules not yet validated with ZRA." if not rule.is_validated else ""
        return (
            f"END Estimated tax this month: {_k(estimated)} "
            f"(on {_k(turnover)} sales). Estimate only, not a ZRA assessment.{extra}"
        )

    if choice == "4":  # simulated TaxPot contribution
        if len(parts) == 1:
            return "CON Amount to save in Kwacha (simulated)"
        amount = _ngwee(parts[1])
        if amount is None:
            return "END Invalid amount. Please dial again."
        if len(parts) == 2:
            return f"CON Save {_k(amount)}. Enter your PIN"
        if not user.check_password(parts[2]):
            return "END Wrong PIN."

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
