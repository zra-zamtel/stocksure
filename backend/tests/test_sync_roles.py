"""Server-side role rules for sync, the registration placeholder, and the USSD
tax period. These close the findings from the review of the sync work (#30)."""
from datetime import date

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

from apps.shops.models import Membership
from apps.sync.models import (
    Reconciliation,
    Sale,
    SaleLine,
    Shop,
    SyncChange,
    TaxPeriod,
    TaxPotEntry,
)
from apps.sync.services import period_id_for
from apps.tax.models import TaxRuleSet

from .test_sync import (
    NOW,
    SyncBase,
    auth,
    sale_payload,
)


class StaffSyncTests(SyncBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.push_schema()

    @override_settings(SALES_BY_STAFF_ONLY_FROM="2026-01-01T00:00:00+00:00")
    def test_an_owner_with_staff_cannot_record_a_sale(self):
        response = self.push([self.change("q_sale", "sale", "sale_1", sale_payload())], user=self.owner)
        self.assertEqual(len(response.json()["rejected"]), 1)
        self.assertFalse(Sale.objects.filter(id="sale_1").exists())

    @override_settings(SALES_BY_STAFF_ONLY_FROM="2026-12-01T00:00:00+00:00")
    def test_an_owner_sale_from_before_the_rule_still_syncs(self):
        response = self.push([self.change("q_sale", "sale", "sale_1", sale_payload())], user=self.owner)
        self.assertEqual(response.json()["rejected"], [])
        self.assertTrue(Sale.objects.filter(id="sale_1").exists())

    @override_settings(SALES_BY_STAFF_ONLY_FROM="2026-01-01T00:00:00+00:00")
    def test_an_owner_without_staff_records_their_own_sales(self):
        Membership.objects.filter(user=self.staff).update(is_active=False)
        response = self.push([self.change("q_sale", "sale", "sale_1", sale_payload())], user=self.owner)
        self.assertEqual(response.json()["rejected"], [])

    def staff_push(self, *changes):
        response = self.push(list(changes), user=self.staff)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_staff_can_record_a_sale_and_the_cost_comes_from_the_server(self):
        payload = sale_payload()
        payload["lines"][0]["buyPrice"] = 0  # a staff phone never sees buy prices
        result = self.staff_push(self.change("s_sale", "sale", "sale_1", payload))

        self.assertEqual(result["rejected"], [])
        line = SaleLine.objects.get(id="line_1")
        self.assertEqual(line.buy_price, 30000)
        self.assertEqual(Sale.objects.get(id="sale_1").recorded_by, self.staff)

    def test_staff_cannot_void_a_sale(self):
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])
        result = self.staff_push(
            self.change(
                "s_void",
                "sale",
                "sale_1",
                {"sale": {"id": "sale_1", "status": "void", "voidReason": "x", "updatedAt": NOW}},
                operation="update",
            )
        )
        self.assertEqual(len(result["rejected"]), 1)
        self.assertEqual(Sale.objects.get(id="sale_1").status, "active")

    def test_staff_may_push_the_matcher_reconcile_status(self):
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])
        result = self.staff_push(
            self.change(
                "s_rec",
                "sale",
                "sale_1",
                {"sale": {"id": "sale_1", "reconcileStatus": "sale_no_payment", "updatedAt": NOW}},
                operation="update",
            )
        )
        self.assertEqual(result["rejected"], [])

    def test_staff_cannot_change_products_prices_or_stock(self):
        result = self.staff_push(
            self.change("s_p", "product", "prod_1", {"id": "prod_1", "name": "Free", "defaultSellPrice": 1}, "update"),
            self.change("s_v", "product_variant", "var_1", {"id": "var_1", "productId": "prod_1", "sellPrice": 1}, "update"),
            self.change(
                "s_m",
                "stock_movement",
                "mv_x",
                {"id": "mv_x", "variantId": "var_1", "quantityChange": 50, "reason": "restock", "createdAt": NOW},
            ),
        )
        self.assertEqual(len(result["rejected"]), 3)

    def test_staff_cannot_confirm_money_or_ignore_a_message(self):
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])
        result = self.staff_push(
            self.change("s_c", "payment", "pay_1", {"id": "pay_1", "confirmedAt": NOW}, "update"),
            self.change(
                "s_t",
                "mobile_money_txn",
                "txn_1",
                {"id": "txn_1", "provider": "MTN", "amount": 100, "receivedAt": NOW, "status": "ignored"},
            ),
        )
        self.assertEqual(len(result["rejected"]), 2)

    def test_staff_cannot_touch_the_taxpot(self):
        result = self.staff_push(
            self.change(
                "s_tp",
                "tax_period",
                "tax_1",
                {"id": "tax_1", "startsOn": "2026-11-01", "endsOn": "2026-11-30", "dueOn": "2026-12-14"},
            )
        )
        self.assertEqual(len(result["rejected"]), 1)

    def test_staff_cash_count_is_blind_and_saved_once(self):
        first = self.staff_push(
            self.change("s_r1", "reconciliation", "rec_1", {"id": "rec_1", "day": "2026-11-17", "countedCash": 5000})
        )
        self.assertEqual(first["rejected"], [])
        second = self.staff_push(
            self.change("s_r2", "reconciliation", "rec_1", {"id": "rec_1", "countedCash": 9000}, "update")
        )
        self.assertEqual(len(second["rejected"]), 1)
        self.assertEqual(Reconciliation.objects.get(id="rec_1").counted_cash, 5000)

    def test_staff_pull_hides_buy_prices_and_tax(self):
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])
        self.push(
            [
                self.change(
                    "q_tax",
                    "tax_period",
                    "tax_1",
                    {"id": "tax_1", "startsOn": "2026-11-01", "endsOn": "2026-11-30", "dueOn": "2026-12-14"},
                ),
            ]
        )
        changes = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.staff)).json()["changes"]
        entities = {change["entity"] for change in changes}

        self.assertIn("sale", entities)
        self.assertNotIn("tax_period", entities)
        product = next(c for c in changes if c["entity"] == "product")
        variant = next(c for c in changes if c["entity"] == "product_variant")
        sale = next(c for c in changes if c["entity"] == "sale")
        self.assertNotIn("defaultBuyPrice", product["payload"])
        self.assertNotIn("buyPrice", variant["payload"])
        self.assertNotIn("buyPrice", sale["payload"]["lines"][0])

        owner_changes = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.owner)).json()["changes"]
        owner_product = next(c for c in owner_changes if c["entity"] == "product")
        self.assertIn("defaultBuyPrice", owner_product["payload"])

    def test_staff_replay_is_recognised_and_cursor_is_real(self):
        change = self.change("s_sale", "sale", "sale_1", sale_payload())
        first = self.staff_push(change)
        second = self.staff_push(change)

        self.assertEqual(second["accepted"], ["s_sale"])
        self.assertEqual(SyncChange.objects.filter(queue_id="s_sale").count(), 1)
        self.assertNotEqual(first["cursor"], "0")


class SaleTotalsTests(SyncBase):
    def setUp(self):
        super().setUp()
        self.push_schema()

    def test_a_sale_needs_lines(self):
        response = self.push(
            [self.change("q_sale", "sale", "sale_1", sale_payload(lines=[], payments=[], stockMovements=[]))]
        )
        self.assertEqual(len(response.json()["rejected"]), 1)

    def test_an_update_cannot_change_the_total_without_the_lines(self):
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])
        response = self.push(
            [
                self.change(
                    "q_up",
                    "sale",
                    "sale_1",
                    {"sale": {"id": "sale_1", "total": 1, "updatedAt": NOW}},
                    operation="update",
                )
            ]
        )
        self.assertEqual(len(response.json()["rejected"]), 1)
        self.assertEqual(Sale.objects.get(id="sale_1").total, 45000)

    def test_rate_used_is_a_fraction(self):
        response = self.push(
            [
                self.change(
                    "q_tax",
                    "tax_period",
                    "tax_1",
                    {
                        "id": "tax_1",
                        "startsOn": "2026-11-01",
                        "endsOn": "2026-11-30",
                        "dueOn": "2026-12-14",
                        "rateUsed": 5,
                    },
                )
            ]
        )
        self.assertEqual(len(response.json()["rejected"]), 1)


class PlaceholderAndUssdTests(SyncBase):
    """Registration makes a placeholder shop; USSD can write to it before the
    phone syncs. The phone's first shop must keep that data, not lose it."""

    def setUp(self):
        super().setUp()
        TaxRuleSet.objects.create(
            name="Test rules",
            version=1,
            rate_percent="5",
            annual_turnover_threshold="5000000",
            effective_from=date(2020, 1, 1),
        )
        now = timezone.now()
        self.placeholder = Shop.objects.create(
            id="shop_placeholder", owner=self.owner, name="Owner's shop", created_at=now, updated_at=now
        )

    def test_ussd_sale_before_phone_sync_is_kept(self):
        from apps.ussd.services import handle

        self.assertTrue(handle("0965551122", "4821*1*150*1").startswith("END Sale of K150.00"))
        response = self.push_schema()

        self.assertEqual(response.json()["rejected"], [])
        self.assertFalse(Shop.objects.filter(id="shop_placeholder").exists())
        self.assertEqual(Sale.objects.filter(shop_id="shop_1").count(), 1)
        pulled = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.owner)).json()["changes"]
        self.assertIn("sale", [change["entity"] for change in pulled])

    def test_ussd_taxpot_before_phone_sync_moves_to_the_phone_period(self):
        from apps.ussd.services import handle

        answer = handle("0971234567", "4821*5*50*1")
        self.assertIn("Saved", answer)
        self.push_schema()

        entry = TaxPotEntry.objects.get()
        self.assertEqual(entry.shop_id, "shop_1")
        self.assertEqual(entry.period_id, period_id_for(entry.shop, entry.period.starts_on))
        self.assertFalse(TaxPeriod.objects.filter(shop_id="shop_placeholder").exists())
        pulled = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.owner)).json()["changes"]
        pot = next(change for change in pulled if change["entity"] == "tax_pot_entry")
        period = next(change for change in pulled if change["entity"] == "tax_period")
        self.assertEqual(pot["payload"]["periodId"], period["entityId"])

    def test_ussd_period_uses_the_shared_id_and_a_fractional_rate(self):
        from apps.ussd.services import handle

        handle("0971234567", "4821*5*50*1")
        period = TaxPeriod.objects.get()

        self.assertEqual(period.id, period_id_for(period.shop, period.starts_on))
        self.assertEqual(float(period.rate_used), 0.05)
        change = SyncChange.objects.get(entity="tax_period")
        self.assertEqual(change.payload["rateUsed"], 0.05)

    def test_ussd_taxpot_can_be_cancelled(self):
        from apps.ussd.services import handle

        self.assertEqual(handle("0971234567", "4821*5*50*2"), "END Nothing was saved.")
        self.assertFalse(TaxPotEntry.objects.exists())
