import json
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from apps.sync.models import (
    MobileMoneyTxn,
    Payment,
    Product,
    ProductVariant,
    Reconciliation,
    Sale,
    SaleLine,
    SyncChange,
    TaxPeriod,
)
from apps.sync.models import Shop as SyncShop
from apps.trading_record import services
from apps.trading_record.models import TradingRecord

from .helpers import BaseTestCase, client_for, make_shop

# Issue "now" is fixed so the 3-month period is always Aug-Oct 2026.
NOW = timezone.make_aware(datetime(2026, 11, 26, 10, 0))
DAY1, DAY2, DAY3 = date(2026, 9, 10), date(2026, 9, 11), date(2026, 10, 5)


def at(day, hour=10, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class TradingRecordTestCase(BaseTestCase):
    def setUp(self):
        super().setUp()
        _legacy, self.owner, self.assistant = make_shop()
        self.shop = SyncShop.objects.get(owner=self.owner)
        product = Product.objects.create(id="p1", shop=self.shop, name="Sneaker", created_at=NOW, updated_at=NOW)
        self.variant = ProductVariant.objects.create(
            id="v1", shop=self.shop, product=product, buy_price=6000, sell_price=10000,
            created_at=NOW, updated_at=NOW,
        )
        self.n = 0

    def sale(self, when, amount, method="cash", *, txn=None, status="active", provider="MTN", ref=""):
        self.n += 1
        sale = Sale.objects.create(
            id=f"s{self.n}", shop=self.shop, created_at=when, updated_at=when,
            subtotal=amount, total=amount, status=status,
        )
        SaleLine.objects.create(
            id=f"l{self.n}", sale=sale, variant=self.variant, quantity=1, buy_price=6000,
            list_price=amount, final_price=amount, created_at=when, updated_at=when,
        )
        Payment.objects.create(
            id=f"pay{self.n}", shop=self.shop, sale=sale, method=method, amount=amount,
            provider=provider if method == "mobile_money" else "", mobile_money_reference=ref,
            matched_txn_id=txn.id if txn else "", created_at=when, updated_at=when,
        )
        return sale

    def txn(self, when, amount, *, status="matched", ref="MP123", sender="0971234567"):
        self.n += 1
        return MobileMoneyTxn.objects.create(
            id=f"t{self.n}", shop=self.shop, provider="MTN", amount=amount, sender=sender, reference=ref,
            received_at=when + timedelta(minutes=2), status=status, raw_message="You received K100 from JOHN",
            created_at=when, updated_at=when,
        )

    def close(self, day, expected, counted):
        Reconciliation.objects.create(
            id=f"r{day}", shop=self.shop, day=day, expected_cash=expected, counted_cash=counted,
            created_at=at(day, 18), updated_at=at(day, 18),
        )

    def issue(self, **kwargs):
        opts = {"months": 3, "expiry_days": 14, "now": NOW, **kwargs}
        return services.issue(self.shop, self.owner, **opts)


class EvidenceTests(TradingRecordTestCase):
    def test_three_lines_never_blend(self):
        good = self.txn(at(DAY1), 10000)
        self.sale(at(DAY1), 10000, "mobile_money", txn=good)                    # matched
        wrong_amount = self.txn(at(DAY1, 11), 9000)
        self.sale(at(DAY1, 11), 10000, "mobile_money", txn=wrong_amount)        # amount disagrees
        self.sale(at(DAY1, 12), 10000, "mobile_money")                          # no SMS
        self.sale(at(DAY1, 13), 20000, "cash")                                  # balanced day
        self.close(DAY1, 20000, 20000)
        self.sale(at(DAY2), 5000, "cash")                                       # short day
        self.close(DAY2, 5000, 4000)
        self.sale(at(DAY3), 7000, "cash")                                       # never closed
        self.sale(at(DAY3, 11), 99900, "cash", status="void")                   # excluded

        record, _token = self.issue()
        totals = record.payload["totals"]
        self.assertEqual(totals["mobile_money_matched"], 10000)
        self.assertEqual(totals["cash_balanced_close"], 20000)
        self.assertEqual(totals["recorded_only"], 10000 + 10000 + 5000 + 7000)
        self.assertEqual(totals["recorded_sales"], 62000)
        self.assertEqual(totals["sale_count"], 6)
        self.assertEqual(
            totals["recorded_sales"],
            totals["mobile_money_matched"] + totals["cash_balanced_close"] + totals["recorded_only"],
        )
        self.assertEqual(record.payload["cash_closes"], {"days_closed": 2, "days_balanced": 1, "days_not_balanced": 1})
        self.assertEqual([m["month"] for m in record.payload["months"]], ["2026-08", "2026-09", "2026-10"])
        self.assertNotIn("verified", json.dumps(record.payload["totals"]))

    def test_reference_and_time_must_agree(self):
        late = self.txn(at(DAY1) + timedelta(days=3), 10000)
        self.sale(at(DAY1), 10000, "mobile_money", txn=late)
        other_ref = self.txn(at(DAY1, 11), 10000, ref="MP999")
        self.sale(at(DAY1, 11), 10000, "mobile_money", txn=other_ref, ref="MP111")
        unmatched = self.txn(at(DAY1, 12), 10000, status="unmatched")
        self.sale(at(DAY1, 12), 10000, "mobile_money", txn=unmatched)
        record, _ = self.issue()
        self.assertEqual(record.payload["totals"]["mobile_money_matched"], 0)

    def test_aggregates_only_no_customer_data(self):
        txn = self.txn(at(DAY1), 10000, sender="0977654321")
        self.sale(at(DAY1), 10000, "mobile_money", txn=txn)
        record, _ = self.issue(include_margin=True, include_tax=True)
        dumped = json.dumps(record.payload)
        for secret in ("0977654321", "JOHN", "Sneaker", "MP123", "pay1", "t1"):
            self.assertNotIn(secret, dumped)

    def test_margin_and_tax_are_opt_in(self):
        self.sale(at(DAY1), 10000, "cash")
        self.close(DAY1, 10000, 10000)
        record, _ = self.issue()
        self.assertIsNone(record.payload["margin"])
        self.assertIsNone(record.payload["tax"])

        TaxPeriod.objects.create(
            id="tax1", shop=self.shop, starts_on=date(2026, 9, 1), ends_on=date(2026, 9, 30), turnover=12000,
            due_on=date(2026, 10, 14), paid=True, created_at=NOW, updated_at=NOW,
        )
        record, _ = self.issue(include_margin=True, include_tax=True)
        self.assertEqual(record.payload["margin"]["gross_margin"], 4000)
        self.assertEqual(record.payload["margin"]["gross_margin_bp"], 4000)
        period = record.payload["tax"]["periods"][0]
        self.assertEqual(period["declared_turnover"], 12000)
        self.assertEqual(period["corroborated_sales"], 10000)
        self.assertEqual(period["variance_vs_corroborated"], 2000)
        self.assertNotIn("paid", period)  # simulated payments are never shown as compliance
        self.assertIn("Simulated", record.payload["tax"]["filing"])

    def test_late_sync_is_visible(self):
        on_time = self.sale(at(DAY1), 10000)
        backfilled = self.sale(at(DAY2), 5000)
        self.sale(at(DAY3), 3000)  # never synced through the pull log
        for sale, delay in ((on_time, timedelta(minutes=5)), (backfilled, timedelta(days=30))):
            change = SyncChange.objects.create(
                shop=self.shop, entity="sale", entity_id=sale.id, operation="create", payload={}
            )
            SyncChange.objects.filter(pk=change.pk).update(created_at=sale.created_at + delay)
        record, _ = self.issue()
        data = record.payload["data"]
        self.assertEqual(data["synced_late_value"], 5000)
        self.assertEqual(data["sync_time_unknown_value"], 3000)
        self.assertEqual(data["data_through"], DAY3.isoformat())
        self.assertIsNotNone(data["first_synced_at"])

    def test_period_bounds_are_complete_months(self):
        self.assertEqual(services.period_bounds(3, date(2026, 11, 26)), (date(2026, 8, 1), date(2026, 10, 31)))
        self.assertEqual(services.period_bounds(12, date(2026, 1, 1)), (date(2025, 1, 1), date(2025, 12, 31)))


class ApiTests(TradingRecordTestCase):
    url = "/api/v1/trading-records/"

    def test_owner_issues_and_link_is_shown_once(self):
        response = client_for(self.owner).post(
            self.url, {"shopId": self.shop.id, "months": 6, "expiresInDays": 30}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(body["verifyUrl"].endswith(f"/verify/{body['token']}/"))
        self.assertTrue(body["qrSvg"].startswith("data:image/svg+xml"))
        record = TradingRecord.objects.get(id=body["id"])
        self.assertEqual(record.token_hash, services.hash_token(body["token"]))
        self.assertEqual(record.expires_at - record.issued_at, timedelta(days=30))

        listing = client_for(self.owner).get(self.url, {"shopId": self.shop.id}).json()
        self.assertEqual(len(listing["records"]), 1)
        self.assertNotIn("token", listing["records"][0])
        self.assertNotIn(body["token"], json.dumps(listing))

    def test_staff_and_strangers_cannot_issue(self):
        response = client_for(self.assistant).post(self.url, {"shopId": self.shop.id}, format="json")
        self.assertEqual(response.status_code, 403)
        response = client_for(self.owner).post(self.url, {}, format="json")
        self.assertEqual(response.status_code, 400)
        response = client_for(self.owner).post(self.url, {"shopId": "someone-else"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_bad_options_are_refused(self):
        client = client_for(self.owner)
        for body in ({"months": 5}, {"expiresInDays": 90}, {"months": "six"}):
            response = client.post(self.url, {"shopId": self.shop.id, **body}, format="json")
            self.assertEqual(response.status_code, 400, body)

    def test_uses_the_named_shop_not_the_first(self):
        second = SyncShop.objects.create(id="second", owner=self.owner, name="Second shop", created_at=NOW,
                                         updated_at=NOW)
        response = client_for(self.owner).post(self.url, {"shopId": second.id}, format="json",
                                               HTTP_X_SHOP_ID=second.id)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["payload"]["business"]["name"], "Second shop")

    def test_revoke(self):
        record, _ = self.issue()
        response = client_for(self.assistant).post(f"{self.url}{record.id}/revoke")
        self.assertEqual(response.status_code, 404)
        response = client_for(self.owner).post(f"{self.url}{record.id}/revoke")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "revoked")


class VerifyTests(TradingRecordTestCase):
    def setUp(self):
        super().setUp()
        self.sale(at(DAY1), 10000, "cash")
        self.close(DAY1, 10000, 10000)
        self.record, self.token = self.issue(now=timezone.now() - timedelta(days=1))

    def test_valid_page_and_json(self):
        page = self.client.get(f"/verify/{self.token}/")
        self.assertEqual(page.status_code, 200)
        html = page.content.decode()
        self.assertIn(services.seal_code(self.record.payload_hash), html)
        self.assertIn("Mobile money matched", html)
        self.assertIn("Cash, balanced close", html)
        self.assertIn("Recorded only", html)
        self.assertIn("K100.00", html)

        data = self.client.get(f"/verify/{self.token}/json/").json()
        self.assertEqual(data["status"], "valid")
        from apps.configs.validators import checksum

        self.assertEqual(checksum(data["payload"]), data["payloadHash"])
        self.record.refresh_from_db()
        self.assertEqual(self.record.view_count, 2)

    def test_tampered_payload_is_caught(self):
        payload = dict(self.record.payload)
        payload["totals"] = {**payload["totals"], "recorded_sales": 99999999}
        TradingRecord.objects.filter(pk=self.record.pk).update(payload=payload)
        response = self.client.get(f"/verify/{self.token}/json/")
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("payload", response.json())

    def test_revoked_and_expired_show_no_figures(self):
        TradingRecord.objects.filter(pk=self.record.pk).update(revoked_at=timezone.now())
        page = self.client.get(f"/verify/{self.token}/")
        self.assertEqual(page.status_code, 410)
        self.assertNotIn("K100.00", page.content.decode())

        TradingRecord.objects.filter(pk=self.record.pk).update(
            revoked_at=None, expires_at=timezone.now() - timedelta(minutes=1)
        )
        data = self.client.get(f"/verify/{self.token}/json/")
        self.assertEqual(data.status_code, 410)
        self.assertEqual(data.json()["status"], "expired")
        self.assertNotIn("payload", data.json())

    def test_unknown_token(self):
        self.assertEqual(self.client.get("/verify/not-a-real-token/").status_code, 404)
        self.assertEqual(self.client.get("/verify/not-a-real-token/json/").json(), {"status": "not_found"})
