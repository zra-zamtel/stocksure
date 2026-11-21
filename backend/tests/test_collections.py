from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.collections.models import PaymentRequest

from .helpers import BaseTestCase, client_for, make_shop

URL = "/api/v1/collections/request-to-pay"


def age(request_id, seconds):
    """Pretend the request was sent `seconds` ago."""
    PaymentRequest.objects.filter(pk=request_id).update(
        created_at=timezone.now() - timedelta(seconds=seconds)
    )


@override_settings(COLLECTIONS_SIMULATED_DELAY_SECONDS=5, COLLECTIONS_TIMEOUT_SECONDS=120)
class RequestToPayTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.shop, self.owner, self.assistant = make_shop()
        self.client = client_for(self.assistant)

    def ask(self, request_id="req_0000001", phone="0971234567", amount=25000, provider="MTN"):
        return self.client.post(
            URL, {"id": request_id, "provider": provider, "phone": phone, "amount": amount}, format="json"
        )

    def poll(self, request_id="req_0000001"):
        return self.client.get(f"{URL}/{request_id}")

    def test_staff_can_ask_and_it_starts_pending(self):
        response = self.ask()

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["status"], "pending")
        self.assertEqual(body["phone"], "260971234567")
        self.assertEqual(body["amount"], 25000)
        self.assertEqual(body["reference"], "")

    def test_the_customer_approves_after_a_moment(self):
        self.ask()
        self.assertEqual(self.poll().json()["status"], "pending")

        age("req_0000001", 6)
        body = self.poll().json()

        self.assertEqual(body["status"], "successful")
        self.assertTrue(body["reference"].startswith("MPSIM"))
        self.assertIsNotNone(body["completedAt"])
        # The answer is stored: a later poll returns the same reference.
        self.assertEqual(self.poll().json()["reference"], body["reference"])

    def test_a_number_ending_000_is_declined(self):
        self.ask(phone="0971234000")
        age("req_0000001", 6)

        body = self.poll().json()

        self.assertEqual(body["status"], "failed")
        self.assertIn("declined", body["reason"])

    def test_no_answer_expires(self):
        self.ask(phone="0971234111")
        age("req_0000001", 60)
        self.assertEqual(self.poll().json()["status"], "pending")

        age("req_0000001", 121)
        self.assertEqual(self.poll().json()["status"], "expired")

    def test_sending_the_same_id_again_does_not_ask_twice(self):
        self.ask()
        again = self.ask(amount=99900)

        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()["amount"], 25000)
        self.assertEqual(PaymentRequest.objects.count(), 1)

    def test_rejects_a_bad_phone_or_amount(self):
        self.assertEqual(self.ask(phone="12345").status_code, 400)
        self.assertEqual(self.ask(request_id="req_0000002", amount=0).status_code, 400)
        self.assertEqual(self.ask(request_id="req_0000003", amount=10_000_000).status_code, 400)

    def test_another_shop_cannot_see_or_reuse_the_request(self):
        self.ask()
        PaymentRequest.objects.update(shop=make_other_shop())

        self.assertEqual(self.poll().status_code, 404)
        self.assertEqual(self.ask().status_code, 404)

    def test_needs_sign_in(self):
        self.assertEqual(APIClient().post(URL, {}, format="json").status_code, 401)


def make_other_shop():
    from apps.accounts.models import User
    from apps.shops.models import Shop

    other = User.objects.create_user("0977000009", "pass", full_name="Other")
    return Shop.objects.create(owner=other, name="Other Shop", town="Ndola")
