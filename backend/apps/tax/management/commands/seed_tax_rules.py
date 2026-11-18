from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.tax.models import TaxRuleSet


class Command(BaseCommand):
    help = (
        "Create a PLACEHOLDER turnover-tax rule set so the estimator works in demos. "
        "The figures are NOT validated: replace them with ZRA-confirmed values (in the admin) "
        "and tick 'validated' before quoting any number."
    )

    def add_arguments(self, parser):
        parser.add_argument("--rate", default="5", help="Turnover-tax rate in percent (default 5).")
        parser.add_argument("--threshold", default="5000000", help="Yearly turnover limit in ZMW (default 5000000).")

    def handle(self, *args, **opts):
        rs, created = TaxRuleSet.objects.get_or_create(
            tax_type="turnover_tax", version=1,
            defaults={
                "name": "Turnover tax - DEMO PLACEHOLDER",
                "rate_percent": Decimal(opts["rate"]),
                "annual_turnover_threshold": Decimal(opts["threshold"]) if opts["threshold"] else None,
                "effective_from": date(2026, 1, 1),
                "is_validated": False,
                "notes": "Placeholder only. Validate rate, threshold and dates with ZRA before real use.",
            },
        )
        msg = "Created" if created else "Already exists:"
        self.stdout.write(self.style.WARNING(f"{msg} {rs}. These figures are NOT validated."))
