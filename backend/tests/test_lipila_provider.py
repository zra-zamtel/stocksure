"""LipilaProvider, with httpx patched: no test here touches the network."""
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from django.test import override_settings

from apps.collections.models import PaymentRequest
from apps.collections.providers import LipilaProvider, ProviderError

from .helpers import BaseTestCase, client_for, make_shop

URL = "/api/v1/collections/request-to-pay"
LIPILA = {
    "LIPILA_API_KEY": "test-key",
    "LIPILA_BASE_URL": "https://lipila.test",
    "LIPILA_TIMEOUT_SECONDS": 5,
    "LIPILA_CALLBACK_URL": "",
    "LIPILA_NARRATION": "StockSure sale",
}


def reply(status_code=200, body=None):
    """A real httpx.Response, so is_success and json() behave as in production."""
    request = httpx.Request("GET", "https://lipila.test")
    return httpx.Response(status_code, json=body if body is not None else {}, request=request)


def payment(request_id="req_0000001", phone="260971234567", amount_ngwee=25000):
    return SimpleNamespace(id=request_id, phone=phone, amount_ngwee=amount_ngwee, provider_reference="")


@override_settings(**LIPILA)
class LipilaStartTests(BaseTestCase):
    def test_sends_kwacha_reference_and_number_without_a_network(self):
        request = payment()
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(200, {"status": "Pending", "identifier": "LP-123"})
            LipilaProvider().start(request)

        (url,), kwargs = post.call_args
        self.assertEqual(url, "https://lipila.test/api/v1/collections/mobile-money")
        body = kwargs["json"]
        self.assertEqual(body["amount"], 250.0)
        self.assertEqual(body["referenceId"], "req_0000001")
        self.assertEqual(body["accountNumber"], "260971234567")
        self.assertEqual(body["currency"], "ZMW")
        self.assertEqual(body["narration"], "StockSure sale")
        self.assertNotIn("provider", body)
        self.assertNotIn("network", body)
        self.assertEqual(kwargs["headers"]["x-api-key"], "test-key")
        self.assertNotIn("callbackUrl", kwargs["headers"])
        self.assertEqual(request.provider_reference, "LP-123")

    @override_settings(LIPILA_CALLBACK_URL="https://shop.test/hook")
    def test_sends_the_callback_url_only_when_set(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(200, {"status": "Pending"})
            LipilaProvider().start(payment())

        self.assertEqual(post.call_args.kwargs["headers"]["callbackUrl"], "https://shop.test/hook")

    def test_a_refusal_carries_lipilas_message(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(400, {"message": "Invalid account number"})
            with self.assertRaisesMessage(ProviderError, "Invalid account number"):
                LipilaProvider().start(payment())

    def test_a_failed_status_on_2xx_is_an_error(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(200, {"status": "Failed", "message": "Insufficient balance"})
            with self.assertRaisesMessage(ProviderError, "Insufficient balance"):
                LipilaProvider().start(payment())

    def test_a_transport_error_becomes_a_provider_error(self):
        with (
            patch("apps.collections.providers.httpx.post", side_effect=httpx.ConnectError("down")),
            self.assertRaises(ProviderError),
        ):
            LipilaProvider().start(payment())


@override_settings(**LIPILA)
class LipilaCheckTests(BaseTestCase):
    def check(self, response):
        with patch("apps.collections.providers.httpx.get") as get:
            get.return_value = response
            result = LipilaProvider().check(payment())
        return result, get

    def test_asks_by_our_reference(self):
        _, get = self.check(reply(200, {"status": "Pending"}))

        (url,), kwargs = get.call_args
        self.assertEqual(url, "https://lipila.test/api/v1/collections/check-status")
        self.assertEqual(kwargs["params"], {"referenceId": "req_0000001"})

    def test_successful(self):
        result, _ = self.check(
            reply(200, {"status": "Successful", "externalId": "MP2611.1234", "message": "Done"})
        )
        self.assertEqual((result.status, result.reference), ("successful", "MP2611.1234"))

    def test_successful_falls_back_to_the_identifier(self):
        result, _ = self.check(reply(200, {"status": "SUCCESSFUL", "identifier": "LP-9"}))
        self.assertEqual((result.status, result.reference), ("successful", "LP-9"))

    def test_failed_keeps_the_reason(self):
        result, _ = self.check(reply(200, {"status": "failed", "message": "Customer declined"}))
        self.assertEqual((result.status, result.reason), ("failed", "Customer declined"))

    def test_failed_without_a_message_still_says_why(self):
        result, _ = self.check(reply(200, {"status": "Failed"}))
        self.assertEqual(result.status, "failed")
        self.assertTrue(result.reason)

    def test_pending_ignores_a_hopeful_message(self):
        result, _ = self.check(reply(200, {"status": "Pending", "message": "Transaction Successful"}))
        self.assertEqual(result.status, "pending")

    def test_an_unknown_status_is_pending(self):
        result, _ = self.check(reply(200, {"status": "Processing"}))
        self.assertEqual(result.status, "pending")

    def test_not_recorded_yet_is_pending_not_failed(self):
        result, _ = self.check(reply(404, {"message": "Not found"}))
        self.assertEqual(result.status, "pending")


@override_settings(
    COLLECTIONS_PROVIDER="apps.collections.providers.LipilaProvider",
    COLLECTIONS_TIMEOUT_SECONDS=300,
    **LIPILA,
)
class LipilaFlowTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.shop, self.owner, self.assistant = make_shop()
        self.client = client_for(self.assistant)

    def ask(self):
        return self.client.post(
            URL,
            {"id": "req_0000001", "provider": "MTN", "phone": "0971234567", "amount": 25000},
            format="json",
        )

    def poll(self):
        return self.client.get(f"{URL}/req_0000001")

    def test_prompt_then_paid_with_lipilas_reference(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(200, {"status": "Pending", "identifier": "LP-123"})
            created = self.ask()
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["status"], "pending")
        self.assertEqual(PaymentRequest.objects.get().provider_reference, "LP-123")

        with patch("apps.collections.providers.httpx.get") as get:
            get.return_value = reply(200, {"status": "Successful", "externalId": "MP2611.1234"})
            body = self.poll().json()

        self.assertEqual(body["status"], "successful")
        self.assertEqual(body["reference"], "MP2611.1234")

    def test_a_status_outage_keeps_the_request_pending(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(200, {"status": "Pending"})
            self.ask()

        with patch("apps.collections.providers.httpx.get", side_effect=httpx.ReadTimeout("slow")):
            response = self.poll()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "pending")

        with patch("apps.collections.providers.httpx.get") as get:
            get.return_value = reply(429, {"message": "Too many requests"})
            response = self.poll()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "pending")

    def test_a_start_outage_fails_the_request_with_the_reason(self):
        with patch("apps.collections.providers.httpx.post") as post:
            post.return_value = reply(400, {"message": "Invalid account number"})
            created = self.ask()

        self.assertEqual(created.status_code, 201)
        body = created.json()
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["reason"], "Invalid account number")
