"""USSD menu logic (Africa's Talking style). The gateway POSTs the caller's number and the full
dial-string so far in `text` ("1*150*1"), and expects "CON ..." (continue) or "END ..." (finish).
State lives in `text`, so the server keeps no session. The web USSD simulator calls the same endpoint."""
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework.exceptions import APIException

from apps.accounts.models import User
from apps.core.utils import normalize_phone
from apps.reconciliation.services import compute_day
from apps.sales import services as sales_services
from apps.sales.models import Sale
from apps.shops.models import Membership, Shop
from apps.tax import services as tax_services
from apps.taxpot import services as taxpot_services
from apps.taxpot.models import SavingsTarget, TaxPotTransaction
from apps.core.utils import local_today, month_bounds

MENU_OWNER = "CON StockSure\n1. Record a sale\n2. Today's summary\n3. Tax estimate\n4. Save to TaxPot"
MENU_ASSISTANT = "CON StockSure\n1. Record a sale\n2. Today's summary"


def _msg(exc):
    d = exc.detail
    if isinstance(d, dict):
        d = next(iter(d.values()))
    if isinstance(d, (list, tuple)):
        d = d[0]
    return str(d)


def _amount(raw):
    try:
        v = Decimal(raw)
    except InvalidOperation:
        return None
    return v if 0 < v < Decimal("1000000") else None


def handle(phone, text):
    phone = normalize_phone(phone)
    parts = [p.strip() for p in (text or "").split("*")] if text else []
    user = User.objects.filter(phone=phone, is_active=True).first()
    try:
        if user is None:
            return _unregistered(phone, parts)
        membership = (
            Membership.objects.select_related("shop")
            .filter(user=user, is_active=True, shop__is_active=True).order_by("id").first()
        )
        if membership is None:
            return "END You are not linked to a shop. Ask the shop owner to add you."
        return _registered(user, membership, parts)
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
    user = User.objects.create_user(phone=phone, password=pin, full_name="Shop owner")
    shop = Shop.objects.create(owner=user, name=name, mode=Shop.Mode.LITE)
    Membership.objects.create(user=user, shop=shop, role=Membership.Role.OWNER)
    return f"END {name} is registered. Dial again to record your first sale."


def _registered(user, membership, parts):
    shop, role = membership.shop, membership.role
    is_owner = role == Membership.Role.OWNER
    if not parts:
        return MENU_OWNER if is_owner else MENU_ASSISTANT
    choice = parts[0]

    if choice == "1":  # record a sale
        if len(parts) == 1:
            return "CON Enter sale amount in Kwacha"
        amount = _amount(parts[1])
        if amount is None:
            return "END Invalid amount. Please dial again."
        if len(parts) == 2:
            return f"CON Sale K{amount:.2f}. Paid by:\n1. Cash\n2. Mobile money"
        method = {"1": Sale.Method.CASH, "2": Sale.Method.MOBILE_MONEY}.get(parts[2])
        if method is None:
            return "END Invalid choice. Please dial again."
        sale, created, _ = sales_services.record_sale(
            shop=shop, user=user, role=role, payment_method=method, amount=amount,
            note="USSD quick sale (no stock items)", allow_amount_only=True,
        )
        return f"END Sale of K{sale.total:.2f} recorded ({sale.get_payment_method_display()})."

    if choice == "2":  # today's summary
        d = compute_day(shop, local_today())
        return (f"END Today: K{d['total_sales']:.2f} from {d['cash_sales_count'] + d['mobile_sales_count']} sales.\n"
                f"Cash K{d['expected_cash']:.2f}, mobile money K{d['mobile_total']:.2f}.")

    if choice in ("3", "4") and not is_owner:
        return "END This option is for the shop owner."

    if choice == "3":  # tax estimate for this month
        start, end = month_bounds(local_today().year, local_today().month)
        r = tax_services.compute_estimate(shop, start, end)
        extra = "\nRules not yet validated with ZRA." if not r["rules_validated"] else ""
        return (f"END Estimated tax this month: K{r['estimated_tax']:.2f} "
                f"(on K{r['basis_income']:.2f} sales). Estimate only, not a ZRA assessment.{extra}")

    if choice == "4":  # simulated TaxPot contribution
        if len(parts) == 1:
            return "CON Amount to save in Kwacha (simulated)"
        amount = _amount(parts[1])
        if amount is None:
            return "END Invalid amount. Please dial again."
        if len(parts) == 2:
            return f"CON Save K{amount:.2f}. Enter your PIN"
        if not user.check_password(parts[2]):
            return "END Wrong PIN."
        target = SavingsTarget.objects.filter(shop=shop, is_active=True).order_by("due_date", "id").first()
        tx = taxpot_services.contribute(
            shop=shop, target=target, amount=amount, source=TaxPotTransaction.Source.USSD, user=user
        )
        return f"END Saved K{tx.amount:.2f} to TaxPot (simulated, no real money moved). Balance K{tx.balance_after:.2f}."

    return "END Invalid choice."
