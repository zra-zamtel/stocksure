"""Months of synced trading history for one phone shop, for the Trading Record demo.

The rows are written the way a phone's pushes would write them (the same upsert
functions plus a pull-log row each), so the owner's phone pulls the history down
and the phone and server agree. Everything is deterministic for a given --seed.

    python manage.py seed_trading_history --owner 260970000001
    python manage.py seed_trading_history --shop <sync shop id> --reset
    python manage.py seed_trading_history --shop <id> --backfilled   # show the late-sync warning

By default each row's sync time is set to a few minutes after it happened, as if
the phone had been syncing every day. --backfilled leaves it at "now", which is
the honest picture for history typed in today, and the record says so.
"""
import random
from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.sync import services as sync
from apps.sync.models import (
    MobileMoneyTxn,
    Product,
    ProductVariant,
    Reconciliation,
    Sale,
    Shop,
    StockMovement,
    SyncChange,
    TaxPeriod,
)

PREFIX = "hist-"
CATALOGUE = [
    # name, category, buy, sell (ngwee), sizes
    ("Men's sneaker", "Shoes", 30000, 45000, ["40", "41", "42", "43"]),
    ("Ladies sandal", "Shoes", 14000, 22000, ["37", "38", "39"]),
    ("Kids school shoe", "Shoes", 11000, 18000, ["31", "32", "33"]),
    ("Canvas slip-on", "Shoes", 9000, 15000, ["39", "41"]),
    ("Leather work boot", "Shoes", 42000, 65000, ["42", "44"]),
    ("Shoe polish", "Care", 1500, 3000, [""]),
]
PROVIDERS = ["MTN", "Airtel", "Zamtel"]
TAX_RATE = 0.05  # matches the placeholder rules from seed_config; not a confirmed ZRA figure


def _iso(dt):
    return dt.isoformat()


class Command(BaseCommand):
    help = "Seed months of phone-shop trading history (sales, MoMo matches, daily closes, tax periods)."

    def add_arguments(self, parser):
        parser.add_argument("--shop", help="Sync shop id (the id the phone uses).")
        parser.add_argument("--owner", help="Owner phone; used when the owner has exactly one sync shop.")
        parser.add_argument("--months", type=int, default=7, help="Months back from today (default 7).")
        parser.add_argument("--seed", type=int, default=2026)
        parser.add_argument("--reset", action="store_true", help="Remove earlier seeded history first.")
        parser.add_argument("--backfilled", action="store_true", help="Leave sync times at now.")

    def handle(self, *args, **opts):
        shop = self._shop(opts)
        with transaction.atomic():
            if opts["reset"]:
                self._reset(shop)
            elif Sale.objects.filter(shop=shop, id__startswith=PREFIX).exists():
                raise CommandError("History already seeded for this shop. Use --reset to rebuild it.")
            counts = self._seed(shop, opts)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {counts['sales']} sales over {counts['days']} trading days for '{shop.name}' ({shop.id})."
        ))
        if opts["backfilled"]:
            self.stdout.write(self.style.WARNING("  Sync times left at now: the record will flag it as back-filled."))
        self.stdout.write("  Pull on the phone (or sign in again) to bring the history down.")

    # ---- which shop --------------------------------------------------------------

    def _shop(self, opts) -> Shop:
        if opts["shop"]:
            shop = Shop.objects.filter(id=opts["shop"]).first()
            if shop is None:
                raise CommandError(f"No sync shop with id {opts['shop']}.")
            return shop
        if not opts["owner"]:
            raise CommandError("Pass --shop <id> or --owner <phone>.")
        owner = User.objects.filter(phone=opts["owner"]).first()
        if owner is None:
            raise CommandError(f"No user with phone {opts['owner']}.")
        shops = list(Shop.objects.filter(owner=owner).order_by("created_at"))
        if len(shops) == 1:
            return shops[0]
        listing = ", ".join(f"{s.id} ({s.name})" for s in shops) or "none"
        raise CommandError(f"Owner has {len(shops)} sync shops: {listing}. Pick one with --shop.")

    def _reset(self, shop: Shop):
        sale_ids = list(Sale.objects.filter(shop=shop, id__startswith=PREFIX).values_list("id", flat=True))
        StockMovement.objects.filter(shop=shop, id__startswith=PREFIX).delete()
        Sale.objects.filter(id__in=sale_ids).delete()  # lines and payments cascade
        MobileMoneyTxn.objects.filter(shop=shop, id__startswith=PREFIX).delete()
        Reconciliation.objects.filter(shop=shop, id__startswith=PREFIX).delete()
        TaxPeriod.objects.filter(shop=shop, id__in=self._seeded_period_ids(shop)).delete()
        ProductVariant.objects.filter(shop=shop, id__startswith=PREFIX).delete()
        Product.objects.filter(shop=shop, id__startswith=PREFIX).delete()
        SyncChange.objects.filter(shop=shop, entity_id__startswith=PREFIX).delete()
        SyncChange.objects.filter(shop=shop, queue_id__startswith=PREFIX).delete()

    def _seeded_period_ids(self, shop):
        return list(
            SyncChange.objects.filter(shop=shop, entity="tax_period", queue_id__startswith=PREFIX)
            .values_list("entity_id", flat=True)
        )

    # ---- generation ----------------------------------------------------------------

    def _seed(self, shop: Shop, opts) -> dict:
        rng = random.Random(opts["seed"])
        owner = shop.owner
        today = timezone.localdate()
        first_day = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        for _ in range(opts["months"] - 1):
            first_day = (first_day - timedelta(days=1)).replace(day=1)
        start_at = timezone.make_aware(datetime.combine(first_day - timedelta(days=1), time(8, 0)))

        log = []  # (entity, entity_id, payload, synced_at)

        def push(entity, entity_id, payload, happened_at):
            synced = happened_at + timedelta(minutes=rng.randint(2, 40))
            log.append((entity, entity_id, payload, synced))

        # Products, then opening stock for every variant.
        variants = []
        for p_index, (name, category, buy, sell, sizes) in enumerate(CATALOGUE):
            pid = f"{PREFIX}prod-{p_index}"
            payload = {"id": pid, "shopId": shop.id, "name": name, "category": category,
                       "defaultBuyPrice": buy, "defaultSellPrice": sell,
                       "createdAt": _iso(start_at), "updatedAt": _iso(start_at)}
            sync.upsert_product(payload, shop)
            push("product", pid, payload, start_at)
            for v_index, size in enumerate(sizes):
                vid = f"{PREFIX}var-{p_index}-{v_index}"
                payload = {"id": vid, "shopId": shop.id, "productId": pid, "size": size, "colour": "",
                           "barcode": "", "buyPrice": buy, "sellPrice": sell, "lowStockLevel": 2,
                           "createdAt": _iso(start_at), "updatedAt": _iso(start_at)}
                sync.upsert_variant(payload, shop)
                push("product_variant", vid, payload, start_at)
                variants.append((vid, buy, sell))

        # Draw the days first so each variant's opening stock covers what it sells.
        plan = []
        day = first_day
        while day < today:
            weekday = day.weekday()
            trades = rng.random() < (0.55 if weekday == 6 else 0.95)
            if trades:
                n = rng.randint(3, 6) + (2 if weekday in (4, 5) else 0) + (2 if day.day >= 25 else 0)
                plan.append((day, [[rng.choice(variants) for _ in range(1 if rng.random() < 0.8 else 2)]
                                   for _ in range(n)]))
            day += timedelta(days=1)

        sold = {}
        for _, sales in plan:
            for lines in sales:
                for vid, _, _ in lines:
                    sold[vid] = sold.get(vid, 0) + 1
        for vid, _, _ in variants:
            mid = f"{PREFIX}open-{vid}"
            payload = {"id": mid, "shopId": shop.id, "variantId": vid, "quantityChange": sold.get(vid, 0) + 4,
                       "reason": "opening", "note": "Opening stock",
                       "createdAt": _iso(start_at), "updatedAt": _iso(start_at)}
            sync.insert_movement(payload, shop)
            push("stock_movement", mid, payload, start_at)

        sale_count = 0
        month_turnover = {}
        for day, sales in plan:
            open_at = timezone.make_aware(datetime.combine(day, time(8, 30)))
            minutes = sorted(rng.sample(range(0, 9 * 60), len(sales)))
            float_ngwee = 20000
            cash_taken = 0
            momo_sales = []
            unpaid = 0
            for s_index, lines in enumerate(sales):
                at = open_at + timedelta(minutes=minutes[s_index])
                sid = f"{PREFIX}sale-{day.isoformat()}-{s_index}"
                line_rows, movements, total = [], [], 0
                for l_index, (vid, buy, sell) in enumerate(lines):
                    discount = 1000 if sell >= 40000 and rng.random() < 0.15 else 0
                    final = sell - discount
                    total += final
                    line_rows.append({"id": f"{sid}-l{l_index}", "saleId": sid, "variantId": vid, "quantity": 1,
                                      "buyPrice": buy, "listPrice": sell, "discount": discount,
                                      "finalPrice": final, "createdAt": _iso(at), "updatedAt": _iso(at)})
                    movements.append({"id": f"{sid}-m{l_index}", "variantId": vid, "quantityChange": -1,
                                      "reason": "sale", "saleId": sid, "createdAt": _iso(at), "updatedAt": _iso(at)})
                momo = rng.random() < 0.55
                payment = {"id": f"{sid}-p", "saleId": sid, "method": "mobile_money" if momo else "cash",
                           "amount": total, "createdAt": _iso(at), "updatedAt": _iso(at)}
                reconcile = "matched"
                txn = None
                if momo:
                    provider = rng.choice(PROVIDERS)
                    payment["provider"] = provider
                    if rng.random() < 0.9:  # the confirmation SMS arrived and was matched
                        tid = f"{PREFIX}txn-{day.isoformat()}-{s_index}"
                        received = at + timedelta(minutes=rng.randint(1, 4))
                        ref = f"{provider[:2].upper()}{rng.randint(10**8, 10**9 - 1)}"
                        txn = {"id": tid, "shopId": shop.id, "provider": provider, "amount": total,
                               "sender": "", "reference": ref, "receivedAt": _iso(received),
                               "rawMessage": "", "parsed": True, "status": "matched",
                               "createdAt": _iso(received), "updatedAt": _iso(received)}
                        momo_sales.append((txn, received))
                        payment.update({"matchedTxnId": tid, "confirmedAt": _iso(received)})
                    else:
                        reconcile = "sale_no_payment"
                        unpaid += 1
                else:
                    cash_taken += total
                sale_payload = {
                    "sale": {"id": sid, "shopId": shop.id, "subtotal": sum(r["listPrice"] for r in line_rows),
                             "discountTotal": sum(r["discount"] for r in line_rows), "total": total,
                             "status": "active", "reconcileStatus": reconcile,
                             "createdAt": _iso(at), "updatedAt": _iso(at)},
                    "lines": line_rows,
                    "payments": [payment],
                    "stockMovements": movements,
                }
                # The SMS is stored before the sale points at it, as on the phone.
                if txn is not None:
                    sync.upsert_mobile_money_txn(txn, shop)
                    push("mobile_money_txn", txn["id"], txn, received)
                sync.upsert_sale(sale_payload, shop, sid, owner, owner=True)
                push("sale", sid, sale_payload, at)
                sale_count += 1
                key = (day.year, day.month)
                month_turnover[key] = month_turnover.get(key, 0) + total

            # Daily close: most days balance, some are short, a few are never closed.
            roll = rng.random()
            if roll < 0.95:
                expected = float_ngwee + cash_taken
                counted = expected if roll < 0.83 else max(expected - rng.choice([1000, 2000, 5000, 10000, 20000]), 0)
                close_at = timezone.make_aware(datetime.combine(day, time(18, 15)))
                rid = f"{PREFIX}close-{day.isoformat()}"
                payload = {"id": rid, "shopId": shop.id, "day": day.isoformat(),
                           "matchedCount": len(momo_sales), "saleNoPaymentCount": unpaid, "paymentNoSaleCount": 0,
                           "openingFloat": float_ngwee, "countedCash": counted, "expectedCash": expected,
                           "note": "" if counted == expected else "Short at close",
                           "createdAt": _iso(close_at), "updatedAt": _iso(close_at)}
                sync.upsert_reconciliation(payload, shop)
                push("reconciliation", rid, payload, close_at)

        # One tax period per complete month, with the phone's id scheme.
        for (year, month), turnover in sorted(month_turnover.items()):
            starts = datetime(year, month, 1).date()
            ends = ((starts + timedelta(days=32)).replace(day=1)) - timedelta(days=1)
            if ends >= today:
                continue
            period_id = sync.period_id_for(shop, starts)
            made = timezone.make_aware(datetime.combine(ends + timedelta(days=1), time(9, 0)))
            payload = {"id": period_id, "shopId": shop.id, "startsOn": starts.isoformat(),
                       "endsOn": ends.isoformat(), "turnover": turnover, "rateUsed": TAX_RATE,
                       "estimatedTax": round(turnover * TAX_RATE), "dueOn": (ends + timedelta(days=14)).isoformat(),
                       "paid": False, "createdAt": _iso(made), "updatedAt": _iso(made)}
            if TaxPeriod.objects.filter(id=period_id).exists():
                continue  # the phone already has this month; leave it alone
            sync.upsert_tax_period(payload, shop)
            push("tax_period", period_id, payload, made)

        # Pull log in the order things happened, so a phone applies parents first.
        log.sort(key=lambda row: row[3])
        rows = SyncChange.objects.bulk_create(
            [SyncChange(shop=shop, queue_id=f"{PREFIX}q-{i}", entity=e, entity_id=eid, operation="create",
                        payload=p, client_created_at=synced) for i, (e, eid, p, synced) in enumerate(log)]
        )
        if not opts["backfilled"]:
            # created_at is auto_now_add, so set the simulated sync times afterwards.
            for row, (_, _, _, synced) in zip(rows, log, strict=True):
                if row.pk is None:
                    row = SyncChange.objects.get(shop=shop, queue_id=row.queue_id)
                SyncChange.objects.filter(pk=row.pk).update(created_at=synced)
        return {"sales": sale_count, "days": len(plan)}
