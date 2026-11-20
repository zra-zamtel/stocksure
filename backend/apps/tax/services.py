from datetime import date
from decimal import Decimal

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from apps.sync.models import Sale
from apps.sync.models import Shop as SyncShop

from .models import DISCLAIMER, TaxRuleSet


def find_rule_set(on_date, tax_type="turnover_tax"):
    from django.db.models import Q

    return (
        TaxRuleSet.objects.filter(tax_type=tax_type, is_active=True, effective_from__lte=on_date)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=on_date))
        .order_by("-version")
        .first()
    )


def _sync_shop(shop):
    """The tax API still receives the legacy Shop from ShopScopedMixin; the
    phone's data lives on the sync shop with the same owner."""
    if isinstance(shop, SyncShop):
        return shop
    return SyncShop.objects.filter(owner=shop.owner).first()


def _turnover(shop: SyncShop, start: date, end: date, *, verified_only=False) -> int:
    qs = Sale.objects.filter(
        shop=shop,
        status=Sale.Status.ACTIVE,
        created_at__date__gte=start,
        created_at__date__lte=end,
    )
    if verified_only:
        qs = qs.filter(reconcile_status=Sale.Reconcile.MATCHED)
    return qs.aggregate(total=Sum("total"))["total"] or 0


def _zmw(ngwee: int) -> Decimal:
    return (Decimal(ngwee) / 100).quantize(Decimal("0.01"))


def compute_estimate(shop, start: date, end: date, include_unverified=True):
    """Estimate turnover tax from the phone's sales.

    ZRA's regime switches to income tax once yearly turnover reaches the
    threshold, so income tax returns a zero turnover-tax estimate and a clear
    message instead of inventing a figure. Money is stored in ngwee on the
    phone and returned here in kwacha for the existing API shape.
    """
    if end < start:
        raise ValidationError({"period": "The end date is before the start date."})
    rules = find_rule_set(end)
    if rules is None:
        raise ValidationError(
            "No tax rules are set up for this period yet. An administrator must add them "
            "(and validate them with ZRA) before estimates can be made."
        )

    sync_shop = _sync_shop(shop)
    if sync_shop is None:
        raise ValidationError("This shop has not synced any sales yet.")

    period_all = _turnover(sync_shop, start, end)
    period_verified = _turnover(sync_shop, start, end, verified_only=True)
    reported = period_all - period_verified
    basis = period_all if include_unverified else period_verified

    ytd = _turnover(sync_shop, date(end.year, 1, 1), end)
    threshold_ngwee = (
        int(rules.annual_turnover_threshold * 100)
        if rules.annual_turnover_threshold
        else None
    )
    income_tax = bool(threshold_ngwee and ytd >= threshold_ngwee)
    estimated_ngwee = (
        0 if income_tax else int(Decimal(basis) * rules.rate_percent / Decimal(100))
    )

    warnings = []
    if not rules.is_validated:
        warnings.append(
            "These tax rules have not been validated with ZRA yet. Do not rely on this figure."
        )
    if income_tax:
        warnings.append(
            f"Your sales this year (K{_zmw(ytd):,.2f}) are at or above the turnover-tax "
            f"threshold (K{rules.annual_turnover_threshold:,.2f}). Income tax applies instead; "
            "confirm with ZRA."
        )
    if reported > 0 and include_unverified:
        warnings.append(
            f"K{_zmw(reported):,.2f} of the sales are still unresolved "
            "(not yet matched to a payment or a balanced close)."
        )

    assumptions = [
        f"Period used: {start:%d %b %Y} to {end:%d %b %Y}.",
        f"Rules used: {rules.name}, version {rules.version}, effective from {rules.effective_from:%d %b %Y}.",
        f"Rate applied: {rules.rate_percent.normalize():f}% of sales in the period.",
        "Sales counted: non-voided sales synced from the phone.",
        "Verified sales are matched to a mobile-money payment or a balanced close."
        + (" Unresolved sales are included." if include_unverified else " Unresolved sales are excluded."),
        "Expenses are not deducted: turnover tax is worked out on sales, not profit.",
        "The threshold is measured on sales so far this calendar year.",
    ]

    return {
        "rule_set": rules,
        "period_start": start,
        "period_end": end,
        "verified_income": _zmw(period_verified),
        "reported_income": _zmw(reported),
        "include_unverified": include_unverified,
        "basis_income": _zmw(basis),
        "rate_percent": rules.rate_percent,
        "estimated_tax": _zmw(estimated_ngwee),
        "income_tax": income_tax,
        "year_to_date_turnover": _zmw(ytd),
        "rules_validated": rules.is_validated,
        "assumptions": assumptions,
        "warnings": warnings,
        "disclaimer": DISCLAIMER,
    }
