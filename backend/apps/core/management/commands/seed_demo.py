"""Seeded demo shop for the video and for QA: Kabwe Shoe Palace, 20 pairs of shoes, a few days of
sales, balanced past closes, today still open (declare K200 less than expected to show the flag),
and a stock-take with exactly one pair missing."""
from datetime import datetime, time, timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.core.utils import local_today
from apps.inventory import services as inv
from apps.inventory.models import Item, StockMovement
from apps.ledger.models import LedgerEntry
from apps.reconciliation import services as recon
from apps.sales import services as sales
from apps.sales.models import MobilePayment
from apps.shops.models import Membership, Shop
from apps.tax import services as tax
from apps.tax.models import TaxEstimate
from apps.taxpot import services as pot
from apps.taxpot.models import SavingsTarget, TaxPotTransaction

OWNER_PHONE, ASSISTANT_PHONE, ADMIN_PHONE = "260970000001", "260970000002", "260970000009"
OWNER_PASSWORD, ASSISTANT_PIN = "demo1234", "1234"


class Command(BaseCommand):
    help = "Create the demo shop with fixed, repeatable data. Use --reset to rebuild it."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete the demo shop and users first.")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["reset"]:
            Shop.objects.filter(owner__phone=OWNER_PHONE).delete()
            User.objects.filter(phone__in=[OWNER_PHONE, ASSISTANT_PHONE, ADMIN_PHONE]).delete()
        if User.objects.filter(phone=OWNER_PHONE).exists():
            self.stdout.write(self.style.WARNING("Demo data already exists. Run with --reset to rebuild."))
            return

        call_command("seed_tax_rules", verbosity=0)
        call_command("seed_taxmate", mark_reviewed=True, verbosity=0)

        owner = User.objects.create_user(OWNER_PHONE, OWNER_PASSWORD, full_name="Mwila Banda (demo owner)")
        assistant = User.objects.create_user(ASSISTANT_PHONE, ASSISTANT_PIN, full_name="Chanda (demo assistant)")
        User.objects.create_superuser(ADMIN_PHONE, OWNER_PASSWORD, full_name="Demo admin")
        shop = Shop.objects.create(
            owner=owner, name="Kabwe Shoe Palace", town="Kabwe", mode=Shop.Mode.FULL,
            zamtel_merchant_number="260970000100", cash_tolerance=0,
        )
        Membership.objects.create(user=owner, shop=shop, role="owner")
        Membership.objects.create(user=assistant, shop=shop, role="assistant")

        # --- 20 pairs of shoes -------------------------------------------------------
        inv.bulk_create_items(shop=shop, user=owner, name="Men's sneaker", category="Shoes", color="Black",
                              price=450, cost_price=300, sizes="40-44", quantity_each=2, kind=StockMovement.Kind.OPENING)
        inv.bulk_create_items(shop=shop, user=owner, name="Ladies sandal", category="Shoes", color="Brown",
                              price=220, cost_price=140, sizes="37-40", quantity_each=2, kind=StockMovement.Kind.OPENING)
        inv.bulk_create_items(shop=shop, user=owner, name="Kids school shoe", category="Shoes", color="Black",
                              price=180, cost_price=110, sizes="32-33", quantity_each=1, kind=StockMovement.Kind.OPENING)

        def item(name, size):
            return Item.objects.get(shop=shop, name=name, size=size)

        today, now = local_today(), timezone.now()
        start_today = timezone.make_aware(datetime.combine(today, time.min))

        def at(days_ago, hour, minute=0):
            if days_ago == 0:  # keep today's sales in the past even early in the morning
                return max(start_today, now - timedelta(minutes=(10 - hour) * 20 + minute + 5))
            return timezone.make_aware(datetime.combine(today - timedelta(days=days_ago), time(hour, minute)))

        def sell(when, method, *lines, payer="260971111111"):
            sale, _, _ = sales.record_sale(
                shop=shop, user=assistant, role="assistant", payment_method=method,
                lines=[{"item": item(n, s).id, "quantity": q} for n, s, q in lines], sold_at=when,
                payer_phone=payer if method == "mobile_money" else "",
            )
            if method == "mobile_money":  # the Zamtel payment arrives a few minutes later
                sales.register_payment(shop=shop, reference=f"SIM-{sale.id:05d}", amount=sale.total,
                                       payer_phone=payer, received_at=when + timedelta(minutes=3),
                                       source=MobilePayment.Source.SIMULATED)
            return sale

        # --- two earlier days: all recorded, cash counted exactly --------------------
        sell(at(2, 9), "cash", ("Men's sneaker", "42", 1))
        sell(at(2, 11), "mobile_money", ("Ladies sandal", "38", 1))
        sell(at(2, 14), "cash", ("Men's sneaker", "43", 1))
        recon.close_day(shop=shop, user=assistant, date=today - timedelta(days=2), declared_cash=900)
        sell(at(1, 10), "cash", ("Men's sneaker", "42", 1))
        sell(at(1, 13), "mobile_money", ("Men's sneaker", "44", 1))
        recon.close_day(shop=shop, user=assistant, date=today - timedelta(days=1), declared_cash=450)

        # --- today (left open on purpose) --------------------------------------------
        sell(at(0, 9), "cash", ("Men's sneaker", "41", 1))
        sell(at(0, 10), "cash", ("Ladies sandal", "39", 1))
        sell(at(0, 10, 30), "mobile_money", ("Kids school shoe", "32", 1))
        preview = recon.compute_day(shop, today)

        # --- a few hand-typed expenses (always trader-reported) ----------------------
        for days_ago, cat, amt, desc in [(3, "transport", 120, "Transport to Lusaka for stock"),
                                         (2, "utilities", 200, "ZESCO"), (1, "rent", 1500, "Shop rent share")]:
            LedgerEntry.objects.create(shop=shop, entry_type="expense", category=cat, amount=amt, description=desc,
                                       entry_date=today - timedelta(days=days_ago), source="manual",
                                       verification="trader_reported", created_by=owner)

        # --- stock-take with exactly ONE pair missing (men's sneaker, black, 40) ----
        take = inv.start_stock_take(shop=shop, user=owner, note="Weekly count")
        for line in take.lines.select_related("item"):
            missing = 1 if (line.item.name == "Men's sneaker" and line.item.size == "40") else 0
            line.counted_qty = line.expected_qty - missing
            line.save(update_fields=["counted_qty"])

        # --- tax estimate + TaxPot target --------------------------------------------
        month_start = today.replace(day=1)
        est = tax.compute_estimate(shop, month_start, today)
        estimate = TaxEstimate.objects.create(shop=shop, created_by=owner, **{k: v for k, v in est.items() if k != "disclaimer"})
        target = SavingsTarget.objects.create(
            shop=shop, estimate=estimate, name="Tax set-aside (estimate)", target_amount=max(estimate.estimated_tax, 1),
            due_date=today + timedelta(days=20), approach="daily",
        )
        pot.contribute(shop=shop, target=target, amount=10, source=TaxPotTransaction.Source.VOLUNTARY, user=owner)

        self.stdout.write(self.style.SUCCESS("Demo shop ready: Kabwe Shoe Palace (20 pairs, Full mode)."))
        self.stdout.write(f"  Owner      {OWNER_PHONE} / {OWNER_PASSWORD}")
        self.stdout.write(f"  Assistant  {ASSISTANT_PHONE} / {ASSISTANT_PIN}")
        self.stdout.write(f"  Admin      {ADMIN_PHONE} / {OWNER_PASSWORD}  (also /admin/)")
        self.stdout.write(f"  Today's expected cash: K{preview['expected_cash']:.2f}. For the demo flag, declare "
                          f"K{max(preview['expected_cash'] - 200, 0):.2f} (K200 short) at daily close.")
        self.stdout.write(f"  Stock-take #{take.id} is open with exactly one pair missing (Men's sneaker, size 40): close it to see the report.")
        self.stdout.write(self.style.WARNING("  Tax rules are a PLACEHOLDER (unvalidated). Do not quote the numbers."))
