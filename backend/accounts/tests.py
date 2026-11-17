import json

from django.test import TestCase

from .models import Owner


class RegisterOwnerTests(TestCase):
    endpoint = "/api/v1/auth/register"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def payload(self, **overrides):
        data = {
            "id": "owner_1",
            "name": "Elton Chiwala",
            "phone": "097 123 4567",
            "pinHash": self.pin_hash,
        }
        data.update(overrides)
        return data

    def post(self, **overrides):
        return self.client.post(
            self.endpoint,
            data=json.dumps(self.payload(**overrides)),
            content_type="application/json",
        )

    def test_registers_owner_and_stores_only_the_hash(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        owner = Owner.objects.get()
        self.assertEqual(owner.phone, "0971234567")
        self.assertEqual(owner.pin_hash, self.pin_hash)
        self.assertEqual(
            response.json(),
            {"id": "owner_1", "name": "Elton Chiwala", "phone": "0971234567"},
        )
        self.assertNotIn("pin", response.json())
        self.assertNotIn("pinHash", response.json())

    def test_normalises_an_international_phone(self):
        response = self.post(phone="+260 97 123 4567")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Owner.objects.filter(phone="0971234567").exists())

    def test_duplicate_phone_gets_a_clear_conflict(self):
        self.post()
        response = self.post(id="owner_2")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
        self.assertEqual(Owner.objects.count(), 1)

    def test_retry_with_same_id_is_idempotent(self):
        first = self.post()
        second = self.post()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Owner.objects.count(), 1)

    def test_retry_can_correct_name_and_pin_hash(self):
        self.post()
        new_hash = "sha256$" + ("c" * 32) + "$" + ("d" * 64)

        response = self.post(name="Elton C.", pinHash=new_hash)

        self.assertEqual(response.status_code, 200)
        owner = Owner.objects.get()
        self.assertEqual(owner.name, "Elton C.")
        self.assertEqual(owner.pin_hash, new_hash)

    def test_id_conflict_is_reported(self):
        self.post()
        response = self.post(phone="096 555 1122")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "id_conflict")

    def test_rejects_a_raw_pin(self):
        response = self.post(pinHash="1234")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_rejects_a_bad_phone(self):
        response = self.post(phone="123")

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())


class RegisterOwnerEdgeTests(TestCase):
    """API edge cases: what the phone can send that the happy path never does."""

    endpoint = "/api/v1/auth/register"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def post(self, body, content_type="application/json"):
        return self.client.post(self.endpoint, data=body, content_type=content_type)

    def valid(self, **overrides):
        data = {"id": "owner_1", "name": "Elton", "phone": "0971234567", "pinHash": self.pin_hash}
        data.update(overrides)
        return json.dumps(data)

    def test_reports_every_missing_field(self):
        response = self.post("{}")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"id", "name", "phone", "pinHash"})

    def test_rejects_a_blank_name(self):
        response = self.post(self.valid(name="   "))

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_trims_the_name(self):
        response = self.post(self.valid(name="  Elton  "))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Owner.objects.get().name, "Elton")

    def test_rejects_malformed_json(self):
        response = self.post("{not json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Owner.objects.count(), 0)

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.endpoint).status_code, 405)

    def test_never_returns_the_pin_hash_on_a_retry(self):
        self.post(self.valid())
        response = self.post(self.valid())

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("pinHash", response.json())
        self.assertNotIn("pin_hash", response.json())

    def test_normalises_phones_exactly_like_the_mobile_app(self):
        # Same cases as mobile/src/core/identity.test.ts: two spellings of one
        # number must never become two accounts.
        from .serializers import normalise_phone

        cases = {
            "097 123 4567": "0971234567",
            "+260 97 123 4567": "0971234567",
            "260971234567": "0971234567",
            "00260971234567": "0971234567",
            "971234567": "0971234567",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalise_phone(raw), expected)

    def test_two_spellings_of_one_number_are_one_account(self):
        self.post(self.valid(id="owner_1", phone="097 123 4567"))
        response = self.post(self.valid(id="owner_2", phone="+260971234567"))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
