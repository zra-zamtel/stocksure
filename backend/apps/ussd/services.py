"""USSD menu logic (Africa's Talking style). The gateway POSTs the caller's number and the full
dial-string so far in `text` ("4821*1*150*1"), and expects "CON ..." (continue) or "END ..." (finish).
State lives in `text`, so the server keeps no session. The web USSD simulator calls the same endpoint.

Every session signs in first. The caller's number picks the account, and the
first input is that person's USSD PIN (set in the app, see apps.ussd.models).
The PIN is checked again on every step, because each step is a fresh request
that repeats it. Numbers with no account are sent to the app to sign up.

USSD is the one place where the server writes shop data itself. It writes the
same `apps.sync` tables the phone uses, so a USSD sale appears in the app when
the phone pulls.
"""
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth.hashers import check_password
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
    SyncChange,
    TaxPeriod,
    TaxPotEntry,
)
from apps.sync.services import period_id_for, resolve_shop, tax_period_payload
from apps.tax.services import compute_estimate

from . import momo
from .models import UssdPaymentRequest, UssdPin
from .sales import record_sale

PIN_LOCK_AFTER = 5
PIN_LOCK_FOR = timedelta(minutes=15)

NO_ACCOUNT = (
    "END This number has no StockSure account. Sign up in the StockSure app, "
    "then set a USSD PIN in Settings."
)
NO_PIN_OWNER = "END Set your USSD PIN first: in the StockSure app open Settings, then USSD PIN."
NO_PIN_STAFF = "END No USSD PIN yet. Ask the shop owner to set one for you in the app (Staff)."
ASK_PIN = "CON StockSure\nEnter your USSD PIN"

MENU_OWNER_SOLO = (
    "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary\n"
    "4. Tax estimate\n5. Save to TaxPot\n6. Payment requests"
)
# An owner with staff leaves selling to them, so this menu starts at 2.
MENU_OWNER = (
    "CON StockSure\n2. Check stock\n3. Today's summary\n"
    "4. Tax estimate\n5. Save to TaxPot\n6. Payment requests"
)
MENU_ASSISTANT = (
    "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary\n4. Payment requests"
)


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


def handle(phone, text, session_id=""):
    phone = normalize_phone(phone)
    parts = [part.strip() for part in (text or "").split("*")] if text else []
    user = User.objects.filter(phone=phone, is_active=True).first()
    if user is None:
        return NO_ACCOUNT
    shop = resolve_shop(user)
    if shop is None:
        return "END You are not linked to a shop. Ask the shop owner to add you."
    is_owner = shop.owner_id == user.id
    if not UssdPin.objects.filter(user=user).exists():
        return NO_PIN_OWNER if is_owner else NO_PIN_STAFF
    if not parts:
        return ASK_PIN
    refused = check_pin(user, parts[0], shop)
    if refused:
        return refused
    if len(parts) == 1:
        # Once per session, before the menu: turn paid requests into sales.
        momo.settle_pending([shop], budget_seconds=3, limit=3)
    try:
        return _registered(
            user, shop, "owner" if is_owner else "assistant", parts[1:], text=text, session_id=session_id
        )
    except APIException as exc:
        return "END " + _msg(exc)


@transaction.atomic
def check_pin(user, pin, shop):
    """None when ``pin`` is the user's USSD PIN, else the END reply to send.

    Five wrong PINs in a row lock dial-in for 15 minutes and email the owner.
    """
    row = UssdPin.objects.select_for_update().filter(user=user).first()
    if row is None:
        return NO_PIN_OWNER if shop.owner_id == user.id else NO_PIN_STAFF
    now = timezone.now()
    if row.locked_until and row.locked_until > now:
        minutes = max(1, int((row.locked_until - now).total_seconds() // 60) + 1)
        return f"END Too many wrong PINs. Try again in {minutes} minutes."

    if check_password(pin, row.pin_hash):
        row.failed_attempts = 0
        row.locked_until = None
        row.last_used_at = now
        row.save(update_fields=["failed_attempts", "locked_until", "last_used_at", "updated_at"])
        return None

    row.failed_attempts += 1
    if row.failed_attempts >= PIN_LOCK_AFTER:
        row.failed_attempts = 0
        row.locked_until = now + PIN_LOCK_FOR
        row.save(update_fields=["failed_attempts", "locked_until", "updated_at"])
        transaction.on_commit(lambda: _notify_locked(user, shop))
        return "END Too many wrong PINs. USSD is locked for 15 minutes."
    row.save(update_fields=["failed_attempts", "updated_at"])
    left = PIN_LOCK_AFTER - row.failed_attempts
    return f"END Wrong PIN. {left} {'try' if left == 1 else 'tries'} left before USSD locks."


def _notify_locked(user, shop):
    from apps.accounts.views import notify_account_change

    who = "your" if shop.owner_id == user.id else f"{user.full_name or 'a staff'} ({user.phone})'s"
    notify_account_change(
        shop.owner,
        "USSD was locked after wrong PINs",
        f"Someone typed {who} USSD PIN wrong {PIN_LOCK_AFTER} times when dialling StockSure, "
        f"so USSD sign-in for {user.phone} is locked for 15 minutes. If this was not "
        "you or your staff, set a new USSD PIN in the app.",
    )


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


@transaction.atomic
def _registered(user, shop, role, parts, *, text="", session_id=""):
    """The menu after sign-in. ``parts`` no longer holds the PIN."""
    is_owner = role == "owner"
    if not parts:
        if not is_owner:
            menu = MENU_ASSISTANT
        else:
            menu = MENU_OWNER_SOLO if owner_may_record_sale(user) else MENU_OWNER
        # Name the shop so the caller knows which account they are in.
        return menu.replace("CON StockSure", f"CON {shop.name[:24]}", 1)
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
        if parts[2] == "1":
            record_sale(shop, user, amount, Payment.Method.CASH)
            return f"END Sale of {_k(amount)} recorded (Cash)."
        if parts[2] != "2":
            return "END Invalid choice. Please dial again."
        return _mobile_money(user, shop, amount, parts[3:], text=text, session_id=session_id)

    if (choice == "4" and not is_owner) or (choice == "6" and is_owner):
        return _payment_requests(user, shop, is_owner)

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
            return f"CON Save {_k(amount)} to TaxPot (simulated)?\n1. Confirm\n2. Cancel"
        if parts[2] == "2":
            return "END Nothing was saved."
        if parts[2] != "1":
            return "END Invalid choice. Please dial again."

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


NETWORK_MENU = "\n1. MTN\n2. Airtel\n3. Zamtel"


def _mobile_money(user, shop, amount, parts, *, text, session_id):
    """After "Mobile money": the network, then a request to the customer's
    wallet, or a sale the customer has already paid by sending money."""
    if not parts:
        return f"CON Sale {_k(amount)} by mobile money. Network:" + NETWORK_MENU
    network = momo.NETWORKS.get(parts[0])
    if network is None:
        return "END Invalid choice. Please dial again."
    if len(parts) == 1:
        return f"CON {network} {_k(amount)}\n1. Send payment request\n2. Customer already paid"
    if parts[1] == "2":
        record_sale(shop, user, amount, Payment.Method.MOBILE_MONEY, provider=network)
        return (
            f"END Sale of {_k(amount)} recorded ({network} mobile money). "
            "It is checked against the payment message on the shop phone."
        )
    if parts[1] != "1":
        return "END Invalid choice. Please dial again."
    if momo.too_large(amount):
        return "END Payment requests are limited to K50,000. Please dial again."
    if len(parts) == 2:
        return f"CON Enter the customer's {network} number"
    phone = momo.customer_number(parts[2])
    if phone is None:
        return "END That is not a valid phone number. Please dial again."
    actual = momo.network_for(phone)
    if actual and actual != network:
        return f"END {momo.local(phone)} is on {actual}, not {network}. Please dial again."
    fee = momo.fee(amount)
    asked = f"{_k(amount + fee)} (incl. {_k(fee)} fee)" if fee else _k(amount)
    if len(parts) == 3:
        return f"CON Ask {momo.local(phone)} to pay {asked} on {network}?\n1. Send\n2. Cancel"
    if parts[3] == "2":
        return "END Cancelled. Nothing was recorded."
    if parts[3] != "1":
        return "END Invalid choice. Please dial again."

    payment = momo.start(
        user, shop, amount=amount, provider=network, phone=phone, rid=momo.request_id(session_id, text)
    )
    if payment is None:
        return "END Payment requests are not set up for this shop. Choose Customer already paid."
    if payment.status == payment.Status.FAILED:
        return f"END Request not sent: {payment.reason or 'the payment service refused it.'}"
    menu = "6" if shop.owner_id == user.id else "4"
    return (
        f"END Request sent to {momo.local(phone)}. They approve it with their PIN, "
        f"then the sale saves. Dial again and choose {menu} to check."
    )


STATUS_LABELS = {
    "pending": "waiting",
    "successful": "paid",
    "failed": "declined",
    "expired": "no answer",
}


def _payment_requests(user, shop, is_owner):
    """The latest USSD requests (the owner sees the whole shop's) and where each stands."""
    links = UssdPaymentRequest.objects.select_related("payment_request", "shop", "requested_by").filter(
        shop=shop
    )
    if not is_owner:
        links = links.filter(requested_by=user)
    links = list(links[:3])
    if not links:
        return "END No payment requests yet."
    lines = ["END Payment requests:"]
    for link in links:
        payment = momo.settle(link)
        link.refresh_from_db(fields=["sale_id"])
        state = "paid, sale saved" if link.sale_id else STATUS_LABELS.get(payment.status, payment.status)
        lines.append(f"{_k(payment.amount_ngwee)} {momo.local(payment.phone)}: {state}")
    return "\n".join(lines)
