from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.tax.models import TaxRuleSet


class Command(BaseCommand):
    help = (
        "Create the turnover-tax rule set ZRA's tax team gave the team on 18 November 2026: "
        "5% of monthly turnover, for businesses below K5,000,000 a year."
    )

    def add_arguments(self, parser):
        parser.add_argument("--rate", default="5", help="Turnover-tax rate in percent (default 5).")
        parser.add_argument("--threshold", default="5000000", help="Yearly turnover limit in ZMW (default 5000000).")

    def handle(self, *args, **opts):
        rs, created = TaxRuleSet.objects.get_or_create(
            tax_type="turnover_tax", version=1,
            defaults={
                "name": "Turnover tax (ZRA guidance, 18 Nov 2026)",
                "rate_percent": Decimal(opts["rate"]),
                "annual_turnover_threshold": Decimal(opts["threshold"]) if opts["threshold"] else None,
                "effective_from": date(2026, 1, 1),
                "is_validated": True,
                "validated_by": "ZRA tax team (guidance to the StockSure team)",
                "validated_on": date(2026, 11, 18),
                "notes": "5% of monthly turnover; income tax from K5,000,000 a year; returns due on the 14th of the next month.",
            },
        )
        msg = "Created" if created else "Already exists:"
        self.stdout.write(self.style.SUCCESS(f"{msg} {rs}."))
