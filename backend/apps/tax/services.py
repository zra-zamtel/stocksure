from datetime import date
from decimal import Decimal

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from apps.core.utils import money
from apps.ledger import services_reports as reports
from apps.ledger.models import LedgerEntry

from .models import DISCLAIMER, TaxRuleSet


def find_rule_set(on_date, tax_type="turnover_tax"):
    return (
        TaxRuleSet.objects.filter(tax_type=tax_type, is_active=True, effective_from__lte=on_date)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=on_date))
        .order_by("-version")
        .first()
    )


def compute_estimate(shop, start: date, end: date, include_unverified=True):
    """Return a dict describing the estimate (not saved). Every figure carries its assumptions."""
    if end < start:
        raise ValidationError({"period": "The end date is before the start date."})
    rules = find_rule_set(end)
    if rules is None:
        raise ValidationError(
            "No tax rules are set up for this period yet. An administrator must add them "
            "(and validate them with ZRA) before estimates can be made."
        )

    income = reports.base_qs(shop, start, end).filter(entry_type=LedgerEntry.Type.INCOME)
    t = reports.totals(income)
    verified, reported = t["verified_income"], t["trader_reported_income"]
    basis = verified + (reported if include_unverified else Decimal("0"))
    tax = money(basis * rules.rate_percent / Decimal("100"))

    warnings = []
    if not rules.is_validated:
        warnings.append(
            "These tax rules have not been validated with ZRA yet. Do not rely on this figure."
        )
    ytd = reports.totals(
        reports.base_qs(shop, date(end.year, 1, 1), end).filter(entry_type=LedgerEntry.Type.INCOME)
    )["income"]
    if rules.annual_turnover_threshold and ytd > rules.annual_turnover_threshold:
        warnings.append(
            f"Your recorded turnover this year (K{ytd:,.2f}) is above the limit in these rules "
            f"(K{rules.annual_turnover_threshold:,.2f}). A different regime may apply: confirm with ZRA."
        )
    if reported > 0 and include_unverified:
        warnings.append(
            f"K{reported:,.2f} of the income is trader-reported (not yet confirmed by matched payments "
            "or a balanced daily close)."
        )

    assumptions = [
        f"Period used: {start:%d %b %Y} to {end:%d %b %Y}.",
        f"Rules used: {rules.name}, version {rules.version}, effective from {rules.effective_from:%d %b %Y}.",
        f"Rate applied: {rules.rate_percent.normalize():f}% of income (turnover) in the period.",
        "Income counted: all non-voided income entries in your ledger for the period.",
        "Verified income is confirmed by matched mobile-money payments or a balanced daily close. "
        + ("Trader-reported income is included." if include_unverified else "Trader-reported income is excluded."),
        "Expenses are not deducted: turnover tax is worked out on turnover, not profit, under these rules.",
        "Rules are configurable and versioned; they may change.",
    ]
    return {
        "rule_set": rules, "period_start": start, "period_end": end,
        "verified_income": verified, "reported_income": reported, "include_unverified": include_unverified,
        "basis_income": basis, "rate_percent": rules.rate_percent, "estimated_tax": tax,
        "rules_validated": rules.is_validated, "assumptions": assumptions, "warnings": warnings,
        "disclaimer": DISCLAIMER,
    }
