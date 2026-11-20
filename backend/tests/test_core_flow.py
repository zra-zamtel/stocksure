import uuid
from datetime import date

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.inventory.models import Item
from apps.ledger.models import LedgerEntry
from apps.notifications.models import Notification
from apps.sales.models import Sale
from apps.sync.models import Sale as SyncSale
from apps.sync.models import Shop as SyncShop
from apps.tax.models import TaxRuleSet
from apps.taxmate.models import ReviewedAnswer

from .helpers import client_for, make_shop


class CoreMatchTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        self.oc, self.ac = client_for(self.owner), client_for(self.assistant)
        r = self.oc.post("/api/items/bulk/", {
            "name": "Sneaker", "color": "Black", "sizes": "40-42", "quantity_each": 3, "price": "450.00",
        }, format="json")
        assert r.status_code == 201, r.content
        self.item = Item.objects.get(shop=self.shop, size="41")

    def sell(self, client, method="cash", qty=1, **extra):
        body = {"payment_method": method, "lines": [{"item": self.item.id, "quantity": qty}], **extra}
        return client.post("/api/sales/", body, format="json")

    def test_sale_reduces_stock_and_creates_unverified_ledger_entry(self):
        r = self.sell(self.ac)
        self.assertEqual(r.status_code, 201, r.content)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 2)
        entry = LedgerEntry.objects.get(sale_id=r.data["id"])
        self.assertEqual(entry.verification, "trader_reported")

    def test_client_id_makes_sales_idempotent(self):
        cid = str(uuid.uuid4())
        self.assertEqual(self.sell(self.ac, client_id=cid).status_code, 201)
        self.assertEqual(self.sell(self.ac, client_id=cid).status_code, 200)
        self.assertEqual(Sale.objects.count(), 1)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 2)

    @override_settings(ALLOW_PAYMENT_SIMULATION=True)
    def test_mobile_money_matches_payment_and_verifies_entry(self):
        r = self.sell(self.ac, method="mobile_money", payment_reference="REF-1")
        self.assertEqual(Sale.objects.get(pk=r.data["id"]).match_status, "pending")
        p = self.oc.post(
            "/api/payments/simulate/", {"amount": "450.00", "reference": "REF-1"}, format="json"
        )
        self.assertEqual(p.status_code, 201, p.content)
        self.assertEqual(p.data["status"], "matched")
        self.assertEqual(LedgerEntry.objects.get(sale_id=r.data["id"]).verification, "verified")

    @override_settings(ALLOW_PAYMENT_SIMULATION=True)
    def test_payment_before_sale_also_matches(self):
        self.oc.post(
            "/api/payments/simulate/", {"amount": "450.00", "reference": "REF-2"}, format="json"
        )
        r = self.sell(self.ac, method="mobile_money", payment_reference="REF-2")
        self.assertEqual(r.data["match_status"], "matched")

    def test_daily_close_flags_gap_and_alerts_owner(self):
        self.sell(self.ac, qty=2)  # 900 cash expected
        r = self.ac.post("/api/daily-closes/", {"declared_cash": "700.00"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["status"], "short")
        self.assertEqual(str(r.data["gap"]), "-200.00")
        self.assertTrue(Notification.objects.filter(shop=self.shop, kind="daily_gap").exists())
        self.assertEqual(LedgerEntry.objects.get(source="sale").verification, "trader_reported")

    def test_balanced_close_verifies_cash_and_locks_the_day(self):
        self.sell(self.ac)
        r = self.ac.post("/api/daily-closes/", {"declared_cash": "450.00"}, format="json")
        self.assertEqual(r.data["status"], "balanced")
        self.assertEqual(LedgerEntry.objects.get(source="sale").verification, "verified")
        self.assertEqual(self.sell(self.ac).status_code, 409)  # day is closed
        self.assertEqual(self.ac.delete(f"/api/daily-closes/{r.data['id']}/").status_code, 403)
        self.assertEqual(self.oc.delete(f"/api/daily-closes/{r.data['id']}/").status_code, 204)
        self.assertEqual(LedgerEntry.objects.get(source="sale").verification, "trader_reported")

    def test_stock_take_reports_exactly_what_is_missing(self):
        self.sell(self.ac)  # expected 2 after the sale
        t = self.oc.post("/api/stock-takes/", {}, format="json").data
        self.oc.post(f"/api/stock-takes/{t['id']}/count/", {"item_id": self.item.id, "counted_qty": 1}, format="json")
        rep = self.oc.get(f"/api/stock-takes/{t['id']}/report/").data
        self.assertEqual(rep["missing_units"], 1)
        self.assertEqual(rep["missing"][0]["item_id"], self.item.id)

    def test_void_restores_stock_and_assistant_cannot_void(self):
        r = self.sell(self.ac)
        self.assertEqual(self.ac.post(f"/api/sales/{r.data['id']}/void/", {"reason": "x"}, format="json").status_code, 403)
        self.assertEqual(self.oc.post(f"/api/sales/{r.data['id']}/void/", {"reason": "wrong item"}, format="json").status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 3)

    def test_assistant_boundaries(self):
        self.assertEqual(self.ac.get("/api/ledger/").status_code, 403)
        self.assertEqual(self.ac.get("/api/taxpot/wallet/").status_code, 403)
        self.assertEqual(self.ac.post("/api/items/", {"name": "x", "price": "1"}, format="json").status_code, 403)
        # assistants do not see cost price
        self.assertNotIn("cost_price", self.ac.get("/api/items/").data["results"][0])

    def test_unknown_shop_header_is_rejected(self):
        c = client_for(self.assistant)
        self.assertEqual(c.get("/api/items/", HTTP_X_SHOP_ID="9999").status_code, 403)


class TaxTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop(mode="lite")
        self.oc = client_for(self.owner)
        self.ac = client_for(self.assistant)
        self.ac.post("/api/sales/", {"payment_method": "cash", "amount": "1000.00"}, format="json")
        self.sync_shop = SyncShop.objects.get(owner=self.owner)
        now = timezone.now()
        SyncSale.objects.create(
            id="tax_sale_1",
            shop=self.sync_shop,
            recorded_by=self.owner,
            subtotal=100000,
            discount_total=0,
            total=100000,
            status="active",
            reconcile_status="unresolved",
            created_at=now,
            updated_at=now,
        )

    def month(self):
        return date.today().strftime("%Y-%m")

    def test_no_rules_means_no_estimate(self):
        r = self.oc.post("/api/tax/estimates/", {"month": self.month()}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_estimate_uses_versioned_rules_and_shows_assumptions(self):
        TaxRuleSet.objects.create(name="Test rules", version=1, rate_percent="5", effective_from=date(2020, 1, 1))
        r = self.oc.post("/api/tax/estimates/", {"month": self.month()}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(str(r.data["estimated_tax"]), "50.00")
        self.assertTrue(r.data["assumptions"])
        self.assertTrue(any("not been validated" in w for w in r.data["warnings"]))
        self.assertIn("not an official", r.data["disclaimer"])

    def test_estimate_can_exclude_unverified_income(self):
        TaxRuleSet.objects.create(name="Test rules", version=1, rate_percent="5", effective_from=date(2020, 1, 1))
        r = self.oc.get(f"/api/tax/estimates/preview/?month={self.month()}&include_unverified=false")
        self.assertEqual(str(r.data["estimated_tax"]), "0.00")
        r = self.oc.get(f"/api/tax/estimates/preview/?month={self.month()}")
        self.assertEqual(str(r.data["estimated_tax"]), "50.00")

    def test_income_tax_applies_at_the_yearly_threshold(self):
        TaxRuleSet.objects.create(
            name="Test rules",
            version=1,
            rate_percent="5",
            annual_turnover_threshold="5000000",
            effective_from=date(2020, 1, 1),
        )
        now = timezone.now()
        SyncSale.objects.create(
            id="tax_sale_big",
            shop=self.sync_shop,
            recorded_by=self.owner,
            subtotal=499900000,
            discount_total=0,
            total=499900000,
            status="active",
            reconcile_status="unresolved",
            created_at=now,
            updated_at=now,
        )

        r = self.oc.post("/api/tax/estimates/", {"month": self.month()}, format="json")

        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.data["income_tax"])
        self.assertEqual(str(r.data["estimated_tax"]), "0.00")
        self.assertEqual(str(r.data["year_to_date_turnover"]), "5000000.00")

    def test_taxpot_target_suggestion_and_contribution(self):
        TaxRuleSet.objects.create(name="Test rules", version=1, rate_percent="5", effective_from=date(2020, 1, 1))
        est = self.oc.post("/api/tax/estimates/", {"month": self.month()}, format="json").data
        due = date.today().replace(year=date.today().year + 1).isoformat()
        t = self.oc.post("/api/taxpot/targets/from-estimate/", {"estimate_id": est["id"], "due_date": due, "approach": "monthly"}, format="json")
        self.assertEqual(t.status_code, 201, t.content)
        s = self.oc.get(f"/api/taxpot/targets/{t.data['id']}/suggestion/").data
        self.assertIsNotNone(s["amount"])
        c = self.oc.post(f"/api/taxpot/targets/{t.data['id']}/contribute/", {"amount": "10.00", "source": "voluntary"}, format="json")
        self.assertEqual(c.status_code, 201, c.content)
        self.assertEqual(str(self.oc.get("/api/taxpot/wallet/").data["balance"]), "10.00")
        self.assertEqual(self.oc.post(f"/api/taxpot/targets/{t.data['id']}/simulate-payment/", {"amount": "999"}, format="json").status_code, 400)


@override_settings(USSD_SHARED_SECRET="gateway-secret")
class TaxMateAndUssdTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop(mode="lite")
        self.oc = client_for(self.owner)

    def test_taxmate_only_answers_from_reviewed_content(self):
        ReviewedAnswer.objects.create(category="tpin", question="What is a TPIN?", keywords="tpin, taxpayer",
                                      answer_en="TPIN is...", is_reviewed=False)
        r = self.oc.post("/api/taxmate/ask/", {"question": "what is a tpin"}, format="json")
        self.assertFalse(r.data["answered"])
        ReviewedAnswer.objects.update(is_reviewed=True)
        r = self.oc.post("/api/taxmate/ask/", {"question": "what is a tpin"}, format="json")
        self.assertTrue(r.data["answered"])
        self.assertIn("official_channel", r.data)

    def ussd(self, phone, text):
        from rest_framework.test import APIClient
        return APIClient().post(
            "/api/ussd/",
            {"phoneNumber": phone, "text": text},
            format="json",
            HTTP_X_USSD_SECRET="gateway-secret",
        ).content.decode()

    def test_ussd_menu_sale_and_summary(self):
        self.assertTrue(self.ussd("0977000001", "").startswith("CON"))
        self.assertTrue(self.ussd("0977000001", "2").startswith("CON Check stock"))
        self.assertTrue(self.ussd("0977000001", "1*150*1").startswith("END Sale of K150.00"))
        self.assertIn("K150.00", self.ussd("0977000001", "3"))
        self.assertTrue(self.ussd("0977000002", "4").startswith("END This option is for the shop owner"))
        self.assertTrue(self.ussd("0977000002", "2").startswith("CON Check stock"))

    def test_ussd_registration(self):
        self.assertTrue(self.ussd("0977999999", "").startswith("CON Welcome"))
        self.assertTrue(self.ussd("0977999999", "1*Mary Boutique*4321").startswith("END Mary Boutique is registered"))
        self.assertTrue(self.ussd("0977999999", "").startswith("CON StockSure"))
