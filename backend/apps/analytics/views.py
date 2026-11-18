from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Sum
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import local_today, month_bounds
from apps.inventory.models import Item, StockTake
from apps.ledger import services_reports as reports
from apps.reconciliation.models import DailyClose
from apps.reconciliation.services import compute_day
from apps.sales.models import MobilePayment, Sale, SaleLine
from apps.shops.models import Shop
from apps.tax import services as tax_services
from apps.tax.models import DISCLAIMER
from apps.taxmate.models import TaxMateQuery
from apps.taxpot import services as taxpot_services
from apps.taxpot.models import SavingsTarget, Wallet

K_MIN = 3  # groups smaller than this are folded into "Other" so no single trader can be identified
ZERO = Decimal("0")


class OwnerDashboardView(ShopScopedMixin, APIView):
    """Owner: sales, stock, gaps, best sellers, tax position. Assistant: just their own day."""

    def get(self, request):
        today = local_today()
        if self.membership.role != "owner":
            mine = Sale.objects.filter(
                shop=self.shop, recorded_by=request.user, sale_date=today, status=Sale.Status.RECORDED
            ).aggregate(count=Count("id"), total=Sum("total"))
            return Response({"role": "assistant", "today": {"sales": mine["count"], "total": mine["total"] or ZERO}})

        day = compute_day(self.shop, today)
        since = today - timedelta(days=30)
        best = (
            SaleLine.objects.filter(sale__shop=self.shop, sale__status=Sale.Status.RECORDED, sale__sale_date__gte=since)
            .values("description").annotate(units=Sum("quantity"), revenue=Sum("line_total")).order_by("-units")[:5]
        )
        last_close = DailyClose.objects.filter(shop=self.shop).first()
        items = Item.objects.filter(shop=self.shop, is_active=True)
        start, end = month_bounds(today.year, today.month)
        month = reports.totals(reports.base_qs(self.shop, start, end))

        tax_position = None
        try:
            r = tax_services.compute_estimate(self.shop, start, end)
            tax_position = {
                "label": "Estimate only - not an official ZRA assessment",
                "estimated_tax": r["estimated_tax"], "period": f"{start} to {end}",
                "rules_validated": r["rules_validated"], "disclaimer": DISCLAIMER,
            }
        except Exception:  # no rules configured yet
            pass

        wallet = taxpot_services.get_wallet(self.shop)
        target = SavingsTarget.objects.filter(shop=self.shop, is_active=True).order_by("due_date").first()
        take = StockTake.objects.filter(shop=self.shop, status=StockTake.Status.CLOSED).first()
        return Response({
            "role": "owner", "shop": self.shop.name, "mode": self.shop.mode,
            "today": {
                "total_sales": day["total_sales"], "cash": day["expected_cash"], "mobile_money": day["mobile_total"],
                "sales_count": day["cash_sales_count"] + day["mobile_sales_count"],
                "unmatched_mobile_sales": day["unmatched_mobile_sales"], "closed": DailyClose.objects.filter(shop=self.shop, date=today).exists(),
            },
            "gaps": {
                "last_close": None if not last_close else {
                    "date": last_close.date, "status": last_close.status, "gap": last_close.gap},
                "flagged_days_last_30": DailyClose.objects.filter(shop=self.shop, date__gte=since).exclude(status="balanced").count(),
                "unmatched_payments": MobilePayment.objects.filter(shop=self.shop, status="unmatched").count(),
            },
            "stock": {
                "items": items.count(), "out_of_stock": items.filter(quantity__lte=0).count(),
                "low_stock": items.filter(quantity__gt=0, quantity__lte=F("reorder_level")).count(),
                "last_stock_take": None if not take else {"closed_at": take.closed_at, **take.summary},
            } if self.shop.is_full else None,
            "best_sellers_30d": list(best),
            "month_to_date": month,
            "tax_position": tax_position,
            "taxpot": {
                "balance": wallet.balance, "simulated": True,
                "next_target": None if not target else {
                    "name": target.name, "due_date": target.due_date, **taxpot_services.progress(target)},
            },
        })


class AdminOverviewView(APIView):
    """Platform-wide aggregates for the admin dashboard. No individual trader, shop or phone is exposed."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        today = local_today()
        d30, d7 = today - timedelta(days=30), today - timedelta(days=7)
        shops = Shop.objects.filter(is_active=True)
        sales30 = Sale.objects.filter(status="recorded", sale_date__gte=d30)
        agg = sales30.aggregate(count=Count("id"), value=Sum("total"))
        mobile = sales30.filter(payment_method="mobile_money").aggregate(value=Sum("total"))["value"] or ZERO
        closes = DailyClose.objects.filter(date__gte=d30)
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
            sales30.filter(sale_date__gte=today - timedelta(days=13)).values("sale_date")
            .annotate(count=Count("id"), value=Sum("total")).order_by("sale_date")
        )
        return Response({
            "note": "Aggregated platform data. Individual traders and shops are not shown.",
            "shops": {
                "total": shops.count(),
                "active_last_7_days": Sale.objects.filter(sale_date__gte=d7).order_by().values("shop").distinct().count(),
                "by_mode": {r["mode"]: r["n"] for r in shops.values("mode").annotate(n=Count("id"))},
                "by_town": towns,
            },
            "sales_last_30_days": {
                "count": agg["count"], "value": agg["value"] or ZERO,
                "mobile_money_share_percent": round(float(mobile / agg["value"] * 100), 1) if agg["value"] else 0,
            },
            "daily_sales_last_14_days": list(daily),
            "daily_close": {
                "closes": closes.count(), "balanced": closes.filter(status="balanced").count(),
                "short": closes.filter(status="short").count(), "over": closes.filter(status="over").count(),
            },
            "taxpot_simulated": {
                "wallets_with_balance": Wallet.objects.filter(balance__gt=0).count(),
                "total_simulated_balance": Wallet.objects.aggregate(t=Sum("balance"))["t"] or ZERO,
                "active_targets": SavingsTarget.objects.filter(is_active=True).count(),
            },
            "taxmate": {
                "questions_last_30_days": q30.count(), "answered": q30.filter(answered=True).count(),
                "unanswered": q30.filter(answered=False).count(),
            },
        })
