from datetime import timedelta

from django.db.models import Count, F, Sum
from django.db.models.functions import Coalesce
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import local_today, month_bounds
from apps.sync.models import (
    MobileMoneyTxn,
    Payment,
    ProductVariant,
    Reconciliation,
    Sale,
    SaleLine,
    Shop,
    TaxPeriod,
    TaxPotEntry,
)
from apps.sync.services import resolve_shop
from apps.tax.models import DISCLAIMER, TaxRuleSet
from apps.taxmate.models import TaxMateQuery

K_MIN = 3  # groups smaller than this are folded into "Other" so no single trader can be identified
ZERO = 0


def _turnover(shop, start, end):
    return (
        Sale.objects.filter(
            shop=shop,
            status=Sale.Status.ACTIVE,
            created_at__date__gte=start,
            created_at__date__lte=end,
        ).aggregate(total=Sum("total"))["total"]
        or ZERO
    )


def _pot_balance(shop):
    entries = TaxPotEntry.objects.filter(shop=shop)
    saved = entries.filter(
        kind__in=[TaxPotEntry.Kind.SET_ASIDE, TaxPotEntry.Kind.TOP_UP]
    ).aggregate(total=Sum("amount"))["total"] or ZERO
    paid = entries.filter(kind=TaxPotEntry.Kind.PAID).aggregate(total=Sum("amount"))[
        "total"
    ] or ZERO
    return saved - paid


class OwnerDashboardView(ShopScopedMixin, APIView):
    """Owner: sales, stock, gaps, best sellers, tax position. Assistant: just their own day."""

    def get(self, request):
        shop = resolve_shop(request.user)
        if shop is None:
            return Response({"role": self.membership.role, "shop": None})
        today = local_today()

        if self.membership.role != "owner":
            mine = Sale.objects.filter(
                shop=shop,
                recorded_by=request.user,
                status=Sale.Status.ACTIVE,
                created_at__date=today,
            ).aggregate(count=Count("id"), total=Sum("total"))
            return Response(
                {
                    "role": "assistant",
                    "today": {"sales": mine["count"] or 0, "total": mine["total"] or ZERO},
                }
            )

        sales = Sale.objects.filter(shop=shop, status=Sale.Status.ACTIVE, created_at__date=today)
        payments = Payment.objects.filter(
            shop=shop, sale__status=Sale.Status.ACTIVE, sale__created_at__date=today
        )
        cash = payments.filter(method=Payment.Method.CASH).aggregate(t=Sum("amount"))["t"] or ZERO
        mobile = payments.filter(method=Payment.Method.MOBILE_MONEY).aggregate(t=Sum("amount"))[
            "t"
        ] or ZERO
        total = sales.aggregate(t=Sum("total"))["t"] or ZERO
        since = today - timedelta(days=30)

        best = (
            SaleLine.objects.filter(
                sale__shop=shop,
                sale__status=Sale.Status.ACTIVE,
                sale__created_at__date__gte=since,
            )
            .values("variant__product__name")
            .annotate(units=Sum("quantity"), revenue=Sum("final_price"))
            .order_by("-units")[:5]
        )
        variants = ProductVariant.objects.filter(shop=shop).annotate(
            qty=Coalesce(Sum("movements__quantity_change"), 0)
        )
        last_close = Reconciliation.objects.filter(shop=shop).order_by("-day").first()
        start, end = month_bounds(today.year, today.month)

        tax_position = None
        rule = TaxRuleSet.objects.filter(is_active=True).order_by("-version").first()
        if rule is not None:
            turnover = _turnover(shop, start, end)
            estimated = int(turnover * rule.rate_percent / 100)
            tax_position = {
                "label": "Estimate only - not an official ZRA assessment",
                "estimated_tax": estimated,
                "period": f"{start} to {end}",
                "rules_validated": rule.is_validated,
                "disclaimer": DISCLAIMER,
            }

        period = TaxPeriod.objects.filter(shop=shop).order_by("-starts_on").first()
        return Response(
            {
                "role": "owner",
                "shop": shop.name,
                "mode": "full" if variants.exists() else "lite",
                "today": {
                    "total_sales": total,
                    "cash": cash,
                    "mobile_money": mobile,
                    "sales_count": sales.count(),
                    "unmatched_mobile_sales": MobileMoneyTxn.objects.filter(
                        shop=shop, status=MobileMoneyTxn.Status.UNMATCHED
                    ).count(),
                    "closed": Reconciliation.objects.filter(shop=shop, day=today).exists(),
                },
                "gaps": {
                    "last_close": None
                    if last_close is None
                    else {
                        "date": last_close.day,
                        "status": "balanced"
                        if last_close.counted_cash == last_close.expected_cash
                        else "short"
                        if (last_close.counted_cash or 0) < last_close.expected_cash
                        else "over",
                        "gap": (last_close.counted_cash or 0) - last_close.expected_cash,
                    },
                    "flagged_days_last_30": Reconciliation.objects.filter(
                        shop=shop, day__gte=since
                    )
                    .exclude(counted_cash=F("expected_cash"))
                    .count(),
                    "unmatched_payments": MobileMoneyTxn.objects.filter(
                        shop=shop, status=MobileMoneyTxn.Status.UNMATCHED
                    ).count(),
                },
                "stock": {
                    "items": variants.count(),
                    "out_of_stock": variants.filter(qty__lte=0).count(),
                    "low_stock": variants.filter(qty__gt=0, qty__lte=F("low_stock_level")).count(),
                },
                "best_sellers_30d": list(best),
                "month_to_date": {
                    "turnover": _turnover(shop, start, end),
                    "period": f"{start} to {end}",
                },
                "tax_position": tax_position,
                "taxpot": {
                    "balance": _pot_balance(shop),
                    "simulated": True,
                    "period": None
                    if period is None
                    else {"id": period.id, "estimated_tax": period.estimated_tax},
                },
            }
        )


class AdminOverviewView(APIView):
    """Platform-wide aggregates for the admin dashboard. No individual trader, shop or phone is exposed."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        today = local_today()
        d30, d7 = today - timedelta(days=30), today - timedelta(days=7)
        shops = Shop.objects.all()
        sales30 = Sale.objects.filter(status=Sale.Status.ACTIVE, created_at__date__gte=d30)
        agg = sales30.aggregate(count=Count("id"), value=Sum("total"))
        mobile = (
            Payment.objects.filter(
                sale__in=sales30, method=Payment.Method.MOBILE_MONEY
            ).aggregate(value=Sum("amount"))["value"]
            or ZERO
        )
        closes = Reconciliation.objects.filter(day__gte=d30)
        q30 = TaxMateQuery.objects.filter(created_at__date__gte=d30)

        towns, other = [], 0
        for row in shops.exclude(town="").values("town").annotate(n=Count("id")).order_by("-n"):
            if row["n"] >= K_MIN:
                towns.append({"town": row["town"], "shops": row["n"]})
            else:
                other += row["n"]
        other += shops.filter(town="").count()
        if other:
            towns.append({"town": "Other", "shops": other})

        daily = (
            sales30.filter(created_at__date__gte=today - timedelta(days=13))
            .values("created_at__date")
            .annotate(count=Count("id"), value=Sum("total"))
            .order_by("created_at__date")
        )
        return Response(
            {
                "note": "Aggregated platform data. Individual traders and shops are not shown.",
                "shops": {
                    "total": shops.count(),
                    "active_last_7_days": Sale.objects.filter(created_at__date__gte=d7)
                    .order_by()
                    .values("shop")
                    .distinct()
                    .count(),
                    "by_town": towns,
                },
                "sales_last_30_days": {
                    "count": agg["count"] or 0,
                    "value": agg["value"] or ZERO,
                    "mobile_money_share_percent": round(
                        float(mobile / agg["value"] * 100), 1
                    )
                    if agg["value"]
                    else 0,
                },
                "daily_sales_last_14_days": list(daily),
                "daily_close": {
                    "closes": closes.count(),
                    "balanced": closes.filter(counted_cash=F("expected_cash")).count(),
                    "short": closes.filter(counted_cash__lt=F("expected_cash")).count(),
                    "over": closes.filter(counted_cash__gt=F("expected_cash")).count(),
                },
                "taxpot_simulated": {
                    "total_simulated_balance": TaxPotEntry.objects.filter(
                        kind__in=[TaxPotEntry.Kind.SET_ASIDE, TaxPotEntry.Kind.TOP_UP]
                    ).aggregate(t=Sum("amount"))["t"]
                    or ZERO,
                },
                "taxmate": {
                    "questions_last_30_days": q30.count(),
                    "answered": q30.filter(answered=True).count(),
                    "unanswered": q30.filter(answered=False).count(),
                },
            }
        )
