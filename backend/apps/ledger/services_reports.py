import csv
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek

from .models import LedgerEntry

TRUNC = {"daily": TruncDay, "weekly": TruncWeek, "monthly": TruncMonth}
ZERO = Decimal("0")


def base_qs(shop, start=None, end=None):
    qs = LedgerEntry.objects.filter(shop=shop, is_void=False)
    if start:
        qs = qs.filter(entry_date__gte=start)
    if end:
        qs = qs.filter(entry_date__lte=end)
    return qs


def totals(qs):
    income = Q(entry_type=LedgerEntry.Type.INCOME)
    expense = Q(entry_type=LedgerEntry.Type.EXPENSE)
    agg = qs.aggregate(
        income=Sum("amount", filter=income),
        expenses=Sum("amount", filter=expense),
        verified_income=Sum("amount", filter=income & Q(verification=LedgerEntry.Verification.VERIFIED)),
        entries=Count("id"),
    )
    inc, exp, ver = agg["income"] or ZERO, agg["expenses"] or ZERO, agg["verified_income"] or ZERO
    return {
        "income": inc, "expenses": exp, "net": inc - exp,
        "verified_income": ver, "trader_reported_income": inc - ver, "entries": agg["entries"],
    }


def summary(shop, period, start=None, end=None):
    trunc = TRUNC[period]("entry_date")
    rows = (
        base_qs(shop, start, end).annotate(bucket=trunc).values("bucket")
        .annotate(
            income=Sum("amount", filter=Q(entry_type="income")),
            expenses=Sum("amount", filter=Q(entry_type="expense")),
            verified_income=Sum("amount", filter=Q(entry_type="income", verification="verified")),
            entries=Count("id"),
        )
        .order_by("bucket")
    )
    out = []
    for r in rows:
        inc, exp, ver = r["income"] or ZERO, r["expenses"] or ZERO, r["verified_income"] or ZERO
        bucket = r["bucket"]
        out.append({
            "period_start": bucket.date() if hasattr(bucket, "date") else bucket,
            "income": inc, "expenses": exp, "net": inc - exp,
            "verified_income": ver, "trader_reported_income": inc - ver, "entries": r["entries"],
        })
    return out


def expense_breakdown(shop, start, end):
    rows = (
        base_qs(shop, start, end).filter(entry_type="expense").values("category")
        .annotate(total=Sum("amount")).order_by("-total")
    )
    return [{"category": r["category"], "total": r["total"]} for r in rows]


def write_csv(response, shop, start, end):
    w = csv.writer(response)
    w.writerow(["date", "type", "category", "amount (ZMW)", "description", "source", "verification"])
    for e in base_qs(shop, start, end).order_by("entry_date", "id"):
        w.writerow([e.entry_date, e.entry_type, e.category, e.amount, e.description, e.source, e.verification])
