from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.exceptions import Conflict
from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import local_today, parse_date, parse_month

from . import services_reports as reports
from .models import LedgerEntry
from .serializers import LedgerEntrySerializer


class LedgerEntryViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    """Business ledger. Sale entries are created automatically; owners add other income/expenses by hand
    (those are always marked trader-reported)."""

    owner_only = True
    queryset = LedgerEntry.objects.filter(is_void=False)
    serializer_class = LedgerEntrySerializer
    search_fields = ["description"]
    ordering_fields = ["entry_date", "amount"]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("from"):
            qs = qs.filter(entry_date__gte=parse_date(p["from"], "from"))
        if p.get("to"):
            qs = qs.filter(entry_date__lte=parse_date(p["to"], "to"))
        for f in ("entry_type", "category", "verification", "source"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        return qs

    def perform_create(self, serializer):
        serializer.save(
            shop=self.shop, created_by=self.request.user,
            source=LedgerEntry.Source.MANUAL, verification=LedgerEntry.Verification.TRADER_REPORTED,
        )

    def _guard_manual(self, entry):
        if entry.source == LedgerEntry.Source.SALE:
            raise Conflict("Sale entries come from recorded sales. Void the sale instead of editing it here.")

    def perform_update(self, serializer):
        self._guard_manual(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._guard_manual(instance)
        instance.delete()

    def _range(self):
        p = self.request.query_params
        if p.get("month"):
            return parse_month(p["month"])
        start = parse_date(p["from"], "from") if p.get("from") else None
        end = parse_date(p["to"], "to") if p.get("to") else None
        return start, end

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """GET /ledger/summary/?period=daily|weekly|monthly&from=&to=  (or ?month=2026-11)"""
        period = request.query_params.get("period", "monthly")
        if period not in reports.TRUNC:
            raise ValidationError({"period": "Use daily, weekly or monthly."})
        start, end = self._range()
        return Response({
            "period": period, "from": start, "to": end,
            "totals": reports.totals(reports.base_qs(self.shop, start, end)),
            "buckets": reports.summary(self.shop, period, start, end),
        })

    @action(detail=False, methods=["get"], url_path="monthly-statement")
    def monthly_statement(self, request):
        """Month-end business summary the owner can view or download: ?month=2026-11[&export=csv]"""
        month = request.query_params.get("month") or local_today().strftime("%Y-%m")
        start, end = parse_month(month)
        if request.query_params.get("export") == "csv":
            resp = HttpResponse(content_type="text/csv")
            resp["Content-Disposition"] = f'attachment; filename="stocksure-ledger-{month}.csv"'
            reports.write_csv(resp, self.shop, start, end)
            return resp
        return Response({
            "shop": self.shop.name, "month": month, "from": start, "to": end,
            "totals": reports.totals(reports.base_qs(self.shop, start, end)),
            "expenses_by_category": reports.expense_breakdown(self.shop, start, end),
            "daily": reports.summary(self.shop, "daily", start, end),
            "note": "Verified = confirmed by matched payments or a balanced daily close. "
                    "Trader-reported = typed in or not yet confirmed.",
        })
