"""Builds and seals a Trading Record from the phone's synced store (apps.sync).

Three evidence lines, never one blended "verified" figure:

1. Mobile money matched: a recorded sale's mobile money payment paired with a
   provider confirmation SMS stored on the phone, with amount, provider,
   reference (when both sides have one) and time agreeing. The server re-checks
   the pair the phone made; it has no provider API to ask.
2. Cash balanced close: cash taken on a day whose close counted exactly the
   expected cash. A consistency check, not independent proof.
3. Recorded only: the rest. Self-reported.

All money is integer ngwee. Sale days are Lusaka-local days, the same days the
phone's daily close uses.
"""
import hashlib
import secrets
from collections import defaultdict
from datetime import date, datetime, time, timedelta

import segno
from django.conf import settings
from django.db import transaction
from django.db.models import F, Min, Sum
from django.utils import timezone

from apps.configs.validators import checksum
from apps.sync.models import (
    MobileMoneyTxn,
    Payment,
    Reconciliation,
    Sale,
    SaleLine,
    Shop,
    SyncChange,
    TaxPeriod,
)

from .models import TradingRecord

SCHEMA = "stocksure.trading-record.v1"
PERIOD_MONTHS = (3, 6, 12)
EXPIRY_DAYS = (14, 30)
# A sale first synced more than this long after it was rung up counts as
# back-filled, so a bank can see history typed in after the fact.
LATE_SYNC_DAYS = 7
# The phone pairs a payment with an SMS inside its own (shorter) window; the
# server only refuses pairs that are plainly far apart.
MATCH_WINDOW = timedelta(hours=24)

LABELS = {
    "mobile_money_matched": "Mobile money matched to a provider confirmation stored on the phone",
    "cash_balanced_close": "Cash on days the daily close balanced (consistency check, not independent proof)",
    "recorded_only": "Recorded only (self-reported)",
}
NOT_THIS = [
    "Not a credit score.",
    "Not audited accounts.",
    "Not a bank statement.",
]


class TradingRecordError(Exception):
    pass


# ---- periods -----------------------------------------------------------------


def _add_months(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)


def period_bounds(months: int, today: date) -> tuple[date, date]:
    """The last ``months`` complete calendar months before ``today``'s month,
    like a bank statement. The current month is left out because it is not over."""
    this_month = today.replace(day=1)
    return _add_months(this_month, -months), this_month - timedelta(days=1)


def _month_keys(start: date, end: date) -> list[str]:
    keys, cursor = [], start.replace(day=1)
    while cursor <= end:
        keys.append(f"{cursor.year:04d}-{cursor.month:02d}")
        cursor = _add_months(cursor, 1)
    return keys


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return (
        timezone.make_aware(datetime.combine(start, time.min)),
        timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min)),
    )


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.get_current_timezone()).isoformat(timespec="seconds") if value else None


# ---- evidence ----------------------------------------------------------------


def _norm_ref(value: str) -> str:
    return "".join((value or "").split()).upper()


def momo_matched(payment: Payment, sale: Sale, txn: MobileMoneyTxn | None) -> bool:
    """The server's re-check of a pair the phone made."""
    if payment.method != Payment.Method.MOBILE_MONEY or txn is None:
        return False
    if txn.status != MobileMoneyTxn.Status.MATCHED or txn.amount != payment.amount:
        return False
    if payment.provider and txn.provider != payment.provider:
        return False
    if abs(txn.received_at - sale.created_at) > MATCH_WINDOW:
        return False
    ours, theirs = _norm_ref(payment.mobile_money_reference), _norm_ref(txn.reference)
    return not (ours and theirs and ours != theirs)


def _empty_bucket():
    return {
        "recorded_sales": 0,
        "sale_count": 0,
        "days": set(),
        "mobile_money_matched": 0,
        "cash_balanced_close": 0,
        "recorded_only": 0,
    }


def summarise(shop: Shop, start: date, end: date, *, include_margin=False, include_tax=False) -> dict:
    """Everything the record shows, from synced rows only. Pure aggregates."""
    start_dt, end_dt = _day_bounds(start, end)
    sales = list(
        Sale.objects.filter(
            shop=shop, status=Sale.Status.ACTIVE, created_at__gte=start_dt, created_at__lt=end_dt
        ).prefetch_related("payments")
    )
    txn_ids = {p.matched_txn_id for s in sales for p in s.payments.all() if p.matched_txn_id}
    txns = {t.id: t for t in MobileMoneyTxn.objects.filter(shop=shop, id__in=txn_ids)} if txn_ids else {}

    closes = list(Reconciliation.objects.filter(shop=shop, day__gte=start, day__lte=end))
    closed = [c for c in closes if c.counted_cash is not None]
    balanced_days = {c.day for c in closed if c.counted_cash == c.expected_cash}

    # First time the server saw each sale, to show back-filled history.
    first_seen = dict(
        SyncChange.objects.filter(shop=shop, entity="sale")
        .values("entity_id")
        .annotate(first=Min("created_at"))
        .values_list("entity_id", "first")
    )

    months = {key: _empty_bucket() for key in _month_keys(start, end)}
    per_day = defaultdict(lambda: [0, 0])  # day -> [recorded, corroborated]
    late_value = unknown_value = 0
    data_through = None

    for sale in sales:
        day = timezone.localtime(sale.created_at).date()
        bucket = months[f"{day.year:04d}-{day.month:02d}"]
        total = sale.total
        momo = sum(
            p.amount for p in sale.payments.all() if momo_matched(p, sale, txns.get(p.matched_txn_id))
        )
        momo = min(momo, total)
        cash = 0
        if day in balanced_days:
            cash = sum(p.amount for p in sale.payments.all() if p.method == Payment.Method.CASH)
            cash = min(cash, total - momo)
        bucket["recorded_sales"] += total
        bucket["sale_count"] += 1
        bucket["days"].add(day)
        bucket["mobile_money_matched"] += momo
        bucket["cash_balanced_close"] += cash
        bucket["recorded_only"] += total - momo - cash
        per_day[day][0] += total
        per_day[day][1] += momo + cash

        seen = first_seen.get(sale.id)
        if seen is None:
            unknown_value += total
        elif seen - sale.created_at > timedelta(days=LATE_SYNC_DAYS):
            late_value += total
        data_through = max(data_through, day) if data_through else day

    month_rows = []
    for key, b in months.items():
        month_rows.append(
            {
                "month": key,
                "recorded_sales": b["recorded_sales"],
                "sale_count": b["sale_count"],
                "trading_days": len(b["days"]),
                "mobile_money_matched": b["mobile_money_matched"],
                "cash_balanced_close": b["cash_balanced_close"],
                "recorded_only": b["recorded_only"],
            }
        )

    def total_of(field):
        return sum(row[field] for row in month_rows)

    first_synced = SyncChange.objects.filter(shop=shop).aggregate(first=Min("created_at"))["first"]

    summary = {
        "totals": {
            "recorded_sales": total_of("recorded_sales"),
            "sale_count": total_of("sale_count"),
            "trading_days": total_of("trading_days"),
            "mobile_money_matched": total_of("mobile_money_matched"),
            "cash_balanced_close": total_of("cash_balanced_close"),
            "recorded_only": total_of("recorded_only"),
        },
        "cash_closes": {
            "days_closed": len(closed),
            "days_balanced": len(balanced_days),
            "days_not_balanced": len(closed) - len(balanced_days),
        },
        "months": month_rows,
        "data": {
            "first_synced_at": _iso(first_synced),
            "data_through": data_through.isoformat() if data_through else None,
            "late_sync_days": LATE_SYNC_DAYS,
            "synced_late_value": late_value,
            "sync_time_unknown_value": unknown_value,
        },
        "margin": _margin(shop, start_dt, end_dt) if include_margin else None,
        "tax": _tax(shop, start, end, per_day) if include_tax else None,
    }
    return summary


def _margin(shop: Shop, start_dt: datetime, end_dt: datetime) -> dict:
    lines = SaleLine.objects.filter(
        sale__shop=shop,
        sale__status=Sale.Status.ACTIVE,
        sale__created_at__gte=start_dt,
        sale__created_at__lt=end_dt,
    )
    totals = lines.aggregate(revenue=Sum("final_price"), cost=Sum(F("buy_price") * F("quantity")))
    costed = lines.filter(buy_price__gt=0).aggregate(revenue=Sum("final_price"))["revenue"] or 0
    revenue, cost = totals["revenue"] or 0, totals["cost"] or 0
    return {
        "revenue": revenue,
        "cost_of_goods": cost,
        "gross_margin": revenue - cost,
        # Basis points keep the payload free of floats: 2350 means 23.50%.
        "gross_margin_bp": (revenue - cost) * 10000 // revenue if revenue else 0,
        "revenue_with_cost_price": costed,
        "note": "Owner-entered buy prices. Expenses such as rent and transport are not included.",
    }


def _tax(shop: Shop, start: date, end: date, per_day) -> dict:
    periods = TaxPeriod.objects.filter(shop=shop, starts_on__gte=start, ends_on__lte=end).order_by("starts_on")
    rows = []
    for period in periods:
        recorded = corroborated = 0
        for day, (rec, cor) in per_day.items():
            if period.starts_on <= day <= period.ends_on:
                recorded += rec
                corroborated += cor
        rows.append(
            {
                "starts_on": period.starts_on.isoformat(),
                "ends_on": period.ends_on.isoformat(),
                "declared_turnover": period.turnover,
                "recorded_sales": recorded,
                "corroborated_sales": corroborated,
                "variance_vs_corroborated": period.turnover - corroborated,
                "status": "draft estimate",
            }
        )
    return {
        "periods": rows,
        "filing": "Simulated. Not filed with or confirmed by ZRA.",
        "amendments": "Not tracked in this prototype.",
        "note": (
            "Supporting document only. Declared turnover is the owner's estimate; "
            "set-aside or tax pot payments are not proof of tax compliance."
        ),
    }


# ---- issue / verify ------------------------------------------------------------


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def seal_code(payload_hash: str) -> str:
    """The short form printed on the PDF and shown on the verify page."""
    return "-".join(payload_hash[i : i + 4] for i in range(0, 16, 4)).upper()


def build_payload(record_id, shop: Shop, owner, months: int, start: date, end: date,
                  issued_at: datetime, expires_at: datetime, *, include_margin: bool, include_tax: bool) -> dict:
    summary = summarise(shop, start, end, include_margin=include_margin, include_tax=include_tax)
    return {
        "schema": SCHEMA,
        "record_id": str(record_id),
        "issued_at": _iso(issued_at),
        "expires_at": _iso(expires_at),
        "currency": shop.currency or "ZMW",
        "amounts_in": "ngwee",
        "business": {
            "name": shop.name,
            "town": shop.town,
            "type": shop.type,
            "owner_name": getattr(owner, "full_name", "") or "",
        },
        "period": {"months": months, "start": start.isoformat(), "end": end.isoformat()},
        **summary,
        "labels": LABELS,
        "not_this": NOT_THIS,
    }


def issue(shop: Shop, user, *, months: int, expiry_days: int, include_margin=False,
          include_tax=False, now: datetime | None = None) -> tuple[TradingRecord, str]:
    if months not in PERIOD_MONTHS:
        raise TradingRecordError("months must be 3, 6 or 12.")
    if expiry_days not in EXPIRY_DAYS:
        raise TradingRecordError("expiresInDays must be 14 or 30.")
    now = (now or timezone.now()).replace(microsecond=0)
    start, end = period_bounds(months, timezone.localtime(now).date())
    expires_at = now + timedelta(days=expiry_days)
    record = TradingRecord(
        shop=shop,
        issued_by=user,
        period_months=months,
        period_start=start,
        period_end=end,
        include_margin=include_margin,
        include_tax=include_tax,
        issued_at=now,
        expires_at=expires_at,
    )
    record.payload = build_payload(
        record.id, shop, shop.owner, months, start, end, now, expires_at,
        include_margin=include_margin, include_tax=include_tax,
    )
    record.payload_hash = checksum(record.payload)
    token = secrets.token_urlsafe(24)
    record.token_hash = hash_token(token)
    record.save()
    return record, token


def find(token: str) -> TradingRecord | None:
    if not token or len(token) > 128:
        return None
    return TradingRecord.objects.select_related("shop").filter(token_hash=hash_token(token)).first()


def intact(record: TradingRecord) -> bool:
    return secrets.compare_digest(checksum(record.payload), record.payload_hash)


def note_view(record: TradingRecord) -> None:
    with transaction.atomic():
        TradingRecord.objects.filter(pk=record.pk).update(
            view_count=F("view_count") + 1, last_viewed_at=timezone.now()
        )


def verify_url(request, token: str) -> str:
    base = getattr(settings, "TRADING_RECORD_PUBLIC_URL", "").rstrip("/")
    path = f"/verify/{token}/"
    return f"{base}{path}" if base else request.build_absolute_uri(path)


def qr_svg_data_uri(url: str) -> str:
    return segno.make(url, error="m").svg_data_uri(scale=4, border=2)


def owner_view(record: TradingRecord) -> dict:
    """What the owner's phone sees in the list: no token, the link was shown once."""
    return {
        "id": str(record.id),
        "periodMonths": record.period_months,
        "periodStart": record.period_start.isoformat(),
        "periodEnd": record.period_end.isoformat(),
        "includeMargin": record.include_margin,
        "includeTax": record.include_tax,
        "issuedAt": _iso(record.issued_at),
        "expiresAt": _iso(record.expires_at),
        "revokedAt": _iso(record.revoked_at),
        "state": record.state(),
        "viewCount": record.view_count,
        "lastViewedAt": _iso(record.last_viewed_at),
        "seal": seal_code(record.payload_hash),
        "payloadHash": record.payload_hash,
        "payload": record.payload,
    }
