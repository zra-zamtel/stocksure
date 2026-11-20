from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.exceptions import Conflict
from apps.core.utils import local_today, money
from apps.ledger import services as ledger
from apps.notifications.models import Notification
from apps.notifications.services import notify_owner
from apps.sales.models import MobilePayment, Sale

from .models import DailyClose


def compute_day(shop, date):
    """Numbers shown to the assistant before they count the till."""
    sales = Sale.objects.filter(shop=shop, sale_date=date, status=Sale.Status.RECORDED)
    cash = sales.filter(payment_method=Sale.Method.CASH).aggregate(t=Sum("total"), n=Count("id"))
    mobile = sales.filter(payment_method=Sale.Method.MOBILE_MONEY).aggregate(t=Sum("total"), n=Count("id"))
    unmatched_sales = sales.filter(
        payment_method=Sale.Method.MOBILE_MONEY, match_status=Sale.Match.PENDING
    ).count()
    # Payments are dated in the shop's local day.
    day_start = timezone.make_aware(datetime.combine(date, time.min))
    unmatched_payments = MobilePayment.objects.filter(
        shop=shop, status=MobilePayment.Status.UNMATCHED,
        received_at__gte=day_start, received_at__lt=day_start + timedelta(days=1),
    ).count()
    cash_total = cash["t"] or Decimal(0)
    mobile_total = mobile["t"] or Decimal(0)
    return {
        "date": date,
        "expected_cash": cash_total,
        "cash_sales_count": cash["n"] or 0,
        "mobile_total": mobile_total,
        "mobile_sales_count": mobile["n"] or 0,
        "total_sales": cash_total + mobile_total,
        "unmatched_mobile_sales": unmatched_sales,
        "unmatched_payments": unmatched_payments,
    }


@transaction.atomic
def close_day(*, shop, user, date, declared_cash, note=""):
    if date > local_today():
        raise ValidationError({"date": "You cannot close a day that has not happened yet."})
    if DailyClose.objects.filter(shop=shop, date=date).exists():
        raise Conflict("This day is already closed. The owner can reopen it if a correction is needed.")

    day = compute_day(shop, date)
    declared = money(declared_cash)
    gap = declared - day["expected_cash"]
    tolerance = shop.cash_tolerance
    if abs(gap) <= tolerance:
        status = DailyClose.Status.BALANCED
    else:
        status = DailyClose.Status.SHORT if gap < 0 else DailyClose.Status.OVER

    close = DailyClose.objects.create(
        shop=shop, date=date, closed_by=user, declared_cash=declared, gap=gap, status=status,
        tolerance_applied=tolerance, note=note,
        **{k: v for k, v in day.items() if k != "date"},
    )
    if status == DailyClose.Status.BALANCED:
        ledger.verify_cash_sales(shop, date)  # cash confirmed by the till count
    else:
        word = "SHORT" if gap < 0 else "OVER"
        extra = ""
        if day["unmatched_mobile_sales"]:
            extra = f" {day['unmatched_mobile_sales']} mobile money sale(s) have no matching payment."
        notify_owner(
            shop, Notification.Kind.DAILY_GAP,
            f"StockSure: {shop.name} {date:%d %b} - cash is K{abs(gap):.2f} {word}. "
            f"Expected K{day['expected_cash']:.2f}, counted K{declared:.2f}.{extra}",
        )
    return close


@transaction.atomic
def reopen_day(close):
    ledger.unverify_cash_sales(close.shop, close.date)
    close.delete()
