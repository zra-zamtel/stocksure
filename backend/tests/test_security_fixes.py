from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.inventory.models import Item
from apps.sales.views import MAX_SYNC_ROWS

from .helpers import client_for, make_shop


class UssdSecurityTests(TestCase):
    def post(self, path="/api/ussd/", **headers):
        return APIClient().post(
            path, {"phoneNumber": "0977000001", "text": ""}, format="json", **headers
        )

    @override_settings(USSD_SHARED_SECRET="", DEBUG=False)
    def test_unset_secret_refuses_requests_outside_debug(self):
        self.assertEqual(self.post().status_code, 403)

    @override_settings(USSD_SHARED_SECRET="", DEBUG=True)
    def test_unset_secret_is_allowed_in_local_debug(self):
        self.assertEqual(self.post().status_code, 200)

    @override_settings(USSD_SHARED_SECRET="gateway-secret", DEBUG=False)
    def test_missing_or_wrong_secret_is_refused(self):
        self.assertEqual(self.post().status_code, 403)
        self.assertEqual(self.post(HTTP_X_USSD_SECRET="wrong").status_code, 403)
        self.assertEqual(self.post("/api/ussd/?token=wrong").status_code, 403)

    @override_settings(USSD_SHARED_SECRET="gateway-secret", DEBUG=False)
    def test_correct_secret_is_allowed(self):
        self.assertEqual(self.post(HTTP_X_USSD_SECRET="gateway-secret").status_code, 200)

    @override_settings(USSD_SHARED_SECRET="gateway-secret", DEBUG=False)
    def test_callback_url_token_is_allowed_for_africas_talking(self):
        # Africa's Talking POSTs form data and cannot add a header, so the
        # secret rides on the callback URL it is configured with.
        self.assertEqual(self.post("/api/ussd/?token=gateway-secret").status_code, 200)

    @override_settings(USSD_SHARED_SECRET="gateway-secret", DEBUG=False)
    def test_africas_talking_form_post_gets_a_plain_text_menu(self):
        response = APIClient().post(
            "/api/ussd/?token=gateway-secret",
            "sessionId=ATUid_1&serviceCode=*384*1%23"
            "&phoneNumber=%2B260970000001&text=",
            content_type="application/x-www-form-urlencoded",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"CON "))
        self.assertTrue(response["Content-Type"].startswith("text/plain"))


class WebhookSecurityTests(TestCase):
    def setUp(self):
        self.shop, _, _ = make_shop()

    def post(self, secret):
        return APIClient().post(
            "/api/webhooks/zamtel/",
            {
                "merchant_number": self.shop.zamtel_merchant_number,
                "reference": "WEBHOOK-1",
                "amount": "10.00",
            },
            format="json",
            HTTP_X_WEBHOOK_SECRET=secret,
        )

    @override_settings(ZAMTEL_WEBHOOK_SECRET="", DEBUG=False)
    def test_unset_secret_refuses_requests_outside_debug(self):
        self.assertEqual(self.post("").status_code, 403)

    @override_settings(ZAMTEL_WEBHOOK_SECRET="hook-secret", DEBUG=False)
    def test_wrong_secret_is_refused(self):
        self.assertEqual(self.post("wrong").status_code, 403)
        self.assertEqual(self.post("").status_code, 403)

    @override_settings(ZAMTEL_WEBHOOK_SECRET="hook-secret", DEBUG=False)
    def test_correct_secret_is_accepted(self):
        self.assertEqual(self.post("hook-secret").status_code, 201)


class PaymentSimulationTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()

    def simulate(self, user):
        return client_for(user).post(
            "/api/payments/simulate/", {"amount": "10.00"}, format="json"
        )

    @override_settings(ALLOW_PAYMENT_SIMULATION=False)
    def test_simulation_is_off_by_default(self):
        self.assertEqual(self.simulate(self.owner).status_code, 403)

    @override_settings(ALLOW_PAYMENT_SIMULATION=True)
    def test_only_the_owner_can_simulate(self):
        self.assertEqual(self.simulate(self.assistant).status_code, 403)
        self.assertEqual(self.simulate(self.owner).status_code, 201)


class OversellTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        self.item = Item.objects.create(
            shop=self.shop, name="Sneaker", size="41", price=Decimal("450.00"), quantity=1
        )

    def sell(self, user, quantity, **extra):
        return client_for(user).post(
            "/api/sales/",
            {
                "payment_method": "cash",
                "lines": [{"item": self.item.id, "quantity": quantity}],
                **extra,
            },
            format="json",
        )

    def test_selling_past_stock_needs_an_override(self):
        response = self.sell(self.assistant, 2)
        self.assertEqual(response.status_code, 400)
        self.assertIn("owner must approve", str(response.data))

    def test_an_assistant_cannot_approve_its_own_override(self):
        response = self.sell(self.assistant, 2, allow_oversell=True)
        self.assertEqual(response.status_code, 400)

    def test_the_owner_can_approve_an_override(self):
        response = self.sell(self.owner, 2, allow_oversell=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.data["warnings"])
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, -1)

    def test_the_owner_still_needs_the_flag(self):
        response = self.sell(self.owner, 2)
        self.assertEqual(response.status_code, 400)


class SyncBatchTests(TestCase):
    def setUp(self):
        self.shop, self.owner, _ = make_shop()

    def test_rows_beyond_the_limit_are_reported_not_dropped(self):
        rows = [{"client_id": None} for _ in range(MAX_SYNC_ROWS + 2)]
        response = client_for(self.owner).post(
            "/api/sales/sync/", {"sales": rows}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), MAX_SYNC_ROWS + 2)
        self.assertIn("Batch limit", str(response.data["results"][-1]["errors"]))
