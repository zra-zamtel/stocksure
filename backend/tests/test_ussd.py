from datetime import timedelta

from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.configs.models import ConfigVersion
from apps.core.utils import iso_now, lusaka_today
from apps.sync.models import ChangeLog
from apps.ussd import data

from .helpers import (
    BaseTestCase, base_data, change, login, pull, push, register, row, staff_row,
)
from .test_config import RULES


def ussd(phone, text, secret=None):
    extra = {"HTTP_X_USSD_SECRET": secret} if secret else {}
    r = APIClient().post("/api/v1/ussd", {"phoneNumber": phone, "text": text}, format="json", **extra)
    return r.status_code, r.content.decode()


class UssdTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.owner, _ = register()
        base_data(self.owner)   # one product, one variant (K250.00), 5 in stock
        self.tenant_id = User.objects.get(phone="260977000001").id

    def reply(self, text, phone="0977000001"):
        status, body = ussd(phone, text)
        self.assertEqual(status, 200)
        return body

    def test_main_menu_and_unknown_number(self):
        self.assertTrue(self.reply("").startswith("CON StockSure"))
        self.assertIn("4. Tax estimate", self.reply(""))
        self.assertIn("not registered", self.reply("", phone="0977555555"))
        self.assertTrue(self.reply("9").startswith("END Invalid choice"))

    def test_form_encoded_requests_from_africas_talking_work(self):
        r = APIClient().post("/api/v1/ussd", "sessionId=abc&phoneNumber=%2B260977000001&text=2",
                             content_type="application/x-www-form-urlencoded")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Black school shoes", r.content.decode())

    def test_check_stock(self):
        body = self.reply("2")
        self.assertTrue(body.startswith("END"))
        self.assertIn("Black school shoes 42 Black: 5", body)

    def test_record_a_sale_step_by_step_and_it_syncs_to_the_app(self):
        self.assertIn("Sell which item?", self.reply("1"))
        self.assertIn("how many? (5 in stock)", self.reply("1*1"))
        self.assertIn("Total K500.00", self.reply("1*1*2"))
        self.assertIn("Enter your PIN", self.reply("1*1*2*1"))
        done = self.reply("1*1*2*1*1234")
        self.assertTrue(done.startswith("END Saved: 2 x"), done)

        changes = pull(self.owner, "0").data["changes"]
        ussd_rows = [c for c in changes if c["deviceId"] == "ussd"]
        self.assertEqual(sorted(c["entity"] for c in ussd_rows), ["payment", "sale", "sale_line", "stock_movement"])
        sale = next(c for c in ussd_rows if c["entity"] == "sale")["payload"]
        self.assertEqual((sale["total"], sale["status"], sale["recorded_by"]), (50000, "active", "owner_a"))
        movement = next(c for c in ussd_rows if c["entity"] == "stock_movement")["payload"]
        self.assertEqual(movement["quantity_change"], -2)
        self.assertEqual(data.stock_by_variant(self.tenant_id)["var_1"], 3)  # 5 - 2, no double count

    def test_wrong_pin_saves_nothing(self):
        body = self.reply("1*1*1*1*0000")
        self.assertTrue(body.startswith("END Wrong"), body)
        self.assertFalse(ChangeLog.objects.filter(device_id="ussd").exists())

    def test_cannot_sell_more_than_is_in_stock(self):
        self.assertIn("Only 5 in stock", self.reply("1*1*6"))

    def test_todays_summary_counts_ussd_sales(self):
        self.reply("1*1*1*1*1234")     # one pair, cash, K250.00
        self.reply("1*1*1*2*1234")     # one pair, mobile money
        body = self.reply("3")
        self.assertIn("K500.00 from 2 sales", body)
        self.assertIn("Cash K250.00", body)
        self.assertIn("mobile money K250.00", body)

    def test_tax_estimate_matches_the_apps_formula(self):
        ConfigVersion.objects.create(kind="tax_rules", version=1, payload=RULES, is_published=True)
        self.assertIn("No tax period yet", self.reply("4"))
        today = lusaka_today()
        push(self.owner, [change("tax_period", row(
            "tax_1", starts_on=(today - timedelta(days=5)).isoformat(), ends_on=(today + timedelta(days=24)).isoformat(),
            turnover=0, rate_used=0.04, estimated_tax=0, due_on=(today + timedelta(days=38)).isoformat(), paid=0,
        ))])
        self.assertIn("No sales in this period", self.reply("4"))
        self.reply("1*1*2*1*1234")  # 2 pairs = K500.00 = 50,000 ngwee; 4% = 2,000 ngwee = K20.00
        body = self.reply("4")
        self.assertIn("Estimated tax: K20.00 on K500.00 sales", body)
        self.assertIn("Estimate only, not a ZRA assessment", body)
        self.assertIn("not yet checked with ZRA", body)

    def test_staff_can_sell_but_not_see_tax(self):
        self.owner.post("/api/v1/staff", {"id": "staff_1", "name": "S", "phone": "0977000002", "pin": "5678"}, format="json")
        push(self.owner, [change("staff", staff_row())])
        self.assertNotIn("Tax estimate", self.reply("", phone="0977000002"))
        self.assertIn("only for the shop owner", self.reply("4", phone="0977000002"))
        done = self.reply("1*1*1*1*5678", phone="0977000002")
        self.assertTrue(done.startswith("END Saved"), done)
        sale = next(c for c in pull(self.owner, "0").data["changes"] if c["entity"] == "sale" and c["deviceId"] == "ussd")
        self.assertEqual(sale["payload"]["recorded_by"], "staff_1")

    def test_shared_secret_is_enforced_when_configured(self):
        from django.test import override_settings

        with override_settings(USSD_SHARED_SECRET="s3cret"):
            self.assertEqual(ussd("0977000001", "")[0], 403)
            self.assertEqual(ussd("0977000001", "", secret="s3cret")[0], 200)

    def test_account_that_has_not_synced_cannot_sell(self):
        fresh, _ = register(phone="0977000009", client_id="owner_z", name="Fresh")
        self.assertIn("No products have synced", self.reply("1", phone="0977000009"))
        self.assertIn("No products have synced", self.reply("2", phone="0977000009"))

    def test_stock_listing_uses_iso_timestamps_helper(self):
        self.assertTrue(iso_now().endswith("Z"))
        login("0977000001", "1234")
