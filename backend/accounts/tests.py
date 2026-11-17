import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import DeviceSession, MagicLinkToken, Owner, PinResetCode, Staff
from .views import issue_device_token


class RegisterOwnerTests(TestCase):
    endpoint = "/api/v1/auth/register"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def payload(self, **overrides):
        data = {
            "id": "owner_1",
            "name": "Elton Chiwala",
            "phone": "097 123 4567",
            "email": "elton@example.com",
            "password": "correct horse battery",
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

    def test_registers_owner_and_stores_only_hashes(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        owner = Owner.objects.get()
        self.assertEqual(owner.phone, "0971234567")
        self.assertEqual(owner.email, "elton@example.com")
        self.assertEqual(owner.pin_hash, self.pin_hash)
        self.assertNotEqual(owner.password_hash, "correct horse battery")
        self.assertTrue(check_password("correct horse battery", owner.password_hash))
        payload = response.json()
        self.assertEqual(
            payload["owner"],
            {
                "id": "owner_1",
                "name": "Elton Chiwala",
                "phone": "0971234567",
                "email": "elton@example.com",
            },
        )
        self.assertTrue(payload["deviceToken"])
        self.assertNotIn("pinHash", payload)
        self.assertNotIn("password", payload)
        self.assertNotIn("password_hash", payload)

    def test_normalises_an_international_phone(self):
        response = self.post(phone="+260 97 123 4567")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Owner.objects.filter(phone="0971234567").exists())

    def test_lowercases_the_email(self):
        response = self.post(email="  ELTON@Example.COM ")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Owner.objects.get().email, "elton@example.com")

    def test_duplicate_phone_gets_a_clear_conflict(self):
        self.post()
        response = self.post(id="owner_2", email="other@example.com")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
        self.assertEqual(Owner.objects.count(), 1)

    def test_duplicate_email_gets_a_clear_conflict(self):
        self.post()
        response = self.post(id="owner_2", phone="096 555 1122")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "email_taken")
        self.assertEqual(Owner.objects.count(), 1)

    def test_a_staff_phone_cannot_become_an_owner_login(self):
        self.post()
        owner = Owner.objects.get()
        Staff.objects.create(
            id="staff_1",
            owner=owner,
            name="Given",
            phone="0965551122",
            pin_hash=self.pin_hash,
        )

        response = self.post(id="owner_2", phone="096 555 1122", email="other@example.com")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
        self.assertEqual(Owner.objects.count(), 1)

    def test_retry_with_same_credentials_is_idempotent(self):
        first = self.post()
        second = self.post()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Owner.objects.count(), 1)

    def test_retry_cannot_change_credentials(self):
        self.post()
        new_hash = "sha256$" + ("c" * 32) + "$" + ("d" * 64)

        response = self.post(
            name="Attacker",
            email="attacker@example.com",
            password="another good password",
            pinHash=new_hash,
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "account_conflict")
        owner = Owner.objects.get()
        self.assertEqual(owner.name, "Elton Chiwala")
        self.assertEqual(owner.email, "elton@example.com")
        self.assertEqual(owner.pin_hash, self.pin_hash)
        self.assertTrue(check_password("correct horse battery", owner.password_hash))

    def test_id_conflict_is_reported(self):
        self.post()
        response = self.post(phone="096 555 1122", email="other@example.com")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "id_conflict")

    def test_rejects_a_short_password(self):
        response = self.post(password="short")

        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())

    def test_rejects_a_bad_email(self):
        response = self.post(email="not-an-email")

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.json())

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
        data = {
            "id": "owner_1",
            "name": "Elton",
            "phone": "0971234567",
            "email": "elton@example.com",
            "password": "correct horse battery",
            "pinHash": self.pin_hash,
        }
        data.update(overrides)
        return json.dumps(data)

    def test_reports_every_missing_field(self):
        response = self.post("{}")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"id", "name", "phone", "email", "password", "pinHash"})

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


@override_settings(EXPOSE_RESET_CODE=True)
class PinResetTests(TestCase):
    request_url = "/api/v1/auth/pin-reset/request"
    confirm_url = "/api/v1/auth/pin-reset/confirm"
    old_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)
    new_hash = "sha256$" + ("c" * 32) + "$" + ("d" * 64)

    def setUp(self):
        self.owner = Owner.objects.create(
            id="owner_1",
            name="Elton Chiwala",
            phone="0971234567",
            pin_hash=self.old_hash,
        )

    def request_code(self, phone="0971234567"):
        return self.client.post(
            self.request_url,
            data=json.dumps({"phone": phone}),
            content_type="application/json",
        )

    def confirm(self, code, phone="0971234567", pin_hash=None):
        return self.client.post(
            self.confirm_url,
            data=json.dumps(
                {"phone": phone, "code": code, "pinHash": pin_hash or self.new_hash}
            ),
            content_type="application/json",
        )

    def get_code(self):
        response = self.request_code()
        self.assertEqual(response.status_code, 200)
        return response.json()["demoCode"]

    def wrong_code(self, code):
        return "000000" if code != "000000" else "111111"

    def test_request_returns_a_demo_code_and_stores_only_its_hash(self):
        response = self.request_code()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertRegex(payload["demoCode"], r"^\d{6}$")
        self.assertIn("expiresAt", payload)
        reset = PinResetCode.objects.get(owner=self.owner)
        self.assertNotEqual(reset.code_hash, payload["demoCode"])
        self.assertFalse(reset.code_hash.startswith("sha256$"))
        self.assertIsNone(reset.used_at)
        self.assertEqual(reset.attempts, 0)

    def test_request_unknown_phone_returns_the_same_generic_shape(self):
        response = self.request_code(phone="0965551122")

        self.assertEqual(response.status_code, 200)
        self.assertIn("expiresAt", response.json())
        self.assertNotIn("demoCode", response.json())

    @override_settings(EXPOSE_RESET_CODE=False)
    def test_code_is_not_returned_when_exposure_is_off(self):
        response = self.request_code()

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("demoCode", response.json())

    def test_confirm_updates_the_owner_pin_hash(self):
        code = self.get_code()
        response = self.confirm(code)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("pinHash", response.json())
        self.assertNotIn("pin_hash", response.json())
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.pin_hash, self.new_hash)
        reset = PinResetCode.objects.get(owner=self.owner)
        self.assertIsNotNone(reset.used_at)

    def test_confirm_marks_the_code_used(self):
        code = self.get_code()
        self.assertEqual(self.confirm(code).status_code, 200)

        second = self.confirm(code)

        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["code"], "invalid_code")

    def test_wrong_code_counts_an_attempt_and_keeps_the_old_pin(self):
        code = self.get_code()
        response = self.confirm(self.wrong_code(code))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_code")
        reset = PinResetCode.objects.get(owner=self.owner)
        self.assertEqual(reset.attempts, 1)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.pin_hash, self.old_hash)

    def test_too_many_attempts_requires_a_new_code(self):
        code = self.get_code()
        wrong = self.wrong_code(code)

        for _ in range(4):
            self.assertEqual(self.confirm(wrong).status_code, 400)

        response = self.confirm(wrong)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_attempts")

    def test_expired_code_is_rejected(self):
        code = self.get_code()
        reset = PinResetCode.objects.get(owner=self.owner)
        reset.expires_at = timezone.now() - timedelta(minutes=1)
        reset.save(update_fields=["expires_at"])

        response = self.confirm(code)

        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "expired_code")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.pin_hash, self.old_hash)

    def test_a_new_request_invalidates_the_previous_code(self):
        with patch("accounts.views.secrets.randbelow", side_effect=[0, 1]):
            first = self.request_code().json()["demoCode"]
            second = self.request_code().json()["demoCode"]

        self.assertEqual(first, "100000")
        self.assertEqual(second, "100001")
        self.assertEqual(self.confirm(first).status_code, 400)
        self.assertEqual(self.confirm(second).status_code, 200)

    def test_confirm_rejects_a_raw_pin(self):
        code = self.get_code()
        response = self.confirm(code, pin_hash="1234")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_confirm_rejects_a_bad_code_format(self):
        response = self.confirm("12ab")

        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.json())

    def test_confirm_unknown_phone_gets_a_generic_invalid_code(self):
        response = self.confirm("123456", phone="0965551122")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_code")


class OwnerLoginTests(TestCase):
    login_url = "/api/v1/auth/login"
    device_pin_url = "/api/v1/auth/device-pin"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def setUp(self):
        self.owner = Owner.objects.create(
            id="owner_1",
            name="Elton Chiwala",
            phone="0971234567",
            email="elton@example.com",
            password_hash=make_password("correct horse battery"),
            pin_hash=self.pin_hash,
        )

    def login(self, **overrides):
        data = {"email": "elton@example.com", "password": "correct horse battery"}
        data.update(overrides)
        return self.client.post(
            self.login_url, data=json.dumps(data), content_type="application/json"
        )

    def test_login_returns_owner_and_a_device_token(self):
        response = self.login()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["owner"]["email"], "elton@example.com")
        self.assertTrue(payload["deviceToken"])
        self.assertEqual(DeviceSession.objects.filter(owner=self.owner).count(), 1)
        self.assertNotIn("password", payload)
        self.assertNotIn("password_hash", payload)

    def test_email_is_case_insensitive(self):
        response = self.login(email="  ELTON@Example.COM ")

        self.assertEqual(response.status_code, 200)

    def test_wrong_password_is_rejected(self):
        response = self.login(password="wrong password")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")
        self.assertEqual(DeviceSession.objects.count(), 0)

    def test_unknown_email_is_rejected(self):
        response = self.login(email="nobody@example.com")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_a_legacy_owner_without_a_password_cannot_log_in(self):
        self.owner.password_hash = ""
        self.owner.save(update_fields=["password_hash"])

        response = self.login()

        self.assertEqual(response.status_code, 401)

    def test_device_token_can_set_the_local_pin(self):
        token = self.login().json()["deviceToken"]
        new_hash = "sha256$" + ("c" * 32) + "$" + ("d" * 64)

        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": new_hash}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.pin_hash, new_hash)
        self.assertNotIn("pinHash", response.json())

    def test_device_token_is_required(self):
        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": self.pin_hash}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "unauthorized")

    def test_a_bad_device_token_is_rejected(self):
        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": self.pin_hash}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer not-a-real-token",
        )

        self.assertEqual(response.status_code, 401)

    def test_device_pin_rejects_a_raw_pin(self):
        token = self.login().json()["deviceToken"]

        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": "1234"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_logout_revokes_the_device_token(self):
        token = self.login().json()["deviceToken"]

        logout = self.client.post(
            "/api/v1/auth/logout",
            data="{}",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(logout.status_code, 200)

        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": self.pin_hash}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 401)

    def test_an_expired_device_token_is_rejected(self):
        token = self.login().json()["deviceToken"]
        session = DeviceSession.objects.get(owner=self.owner)
        session.expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["expires_at"])

        response = self.client.post(
            self.device_pin_url,
            data=json.dumps({"pinHash": self.pin_hash}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 401)

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.login_url).status_code, 405)
        self.assertEqual(self.client.get(self.device_pin_url).status_code, 405)


@override_settings(EXPOSE_EMAIL_TOKEN=True)
class MagicLinkTests(TestCase):
    request_url = "/api/v1/auth/magic-link/request"
    verify_url = "/api/v1/auth/magic-link/verify"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def setUp(self):
        self.owner = Owner.objects.create(
            id="owner_1",
            name="Elton Chiwala",
            phone="0971234567",
            email="elton@example.com",
            password_hash=make_password("correct horse battery"),
            pin_hash=self.pin_hash,
        )

    def request_link(self, email="elton@example.com"):
        return self.client.post(
            self.request_url,
            data=json.dumps({"email": email}),
            content_type="application/json",
        )

    def verify(self, token):
        return self.client.post(
            self.verify_url,
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

    def get_token(self):
        response = self.request_link()
        self.assertEqual(response.status_code, 200)
        return response.json()["demoToken"]

    def test_request_sends_a_single_use_link(self):
        response = self.request_link()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["demoToken"])
        self.assertIn("stocksure://magic-link?token=", payload["demoUrl"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["elton@example.com"])
        self.assertIn(payload["demoToken"], mail.outbox[0].body)
        link = MagicLinkToken.objects.get(owner=self.owner)
        self.assertNotEqual(link.token_hash, payload["demoToken"])
        self.assertIsNone(link.used_at)

    def test_unknown_email_gets_the_same_generic_response_without_sending(self):
        response = self.request_link(email="nobody@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("demoToken", response.json())
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(MagicLinkToken.objects.count(), 0)

    def test_verify_signs_in_marks_email_verified_and_issues_a_device(self):
        token = self.get_token()

        response = self.verify(token)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["owner"]["email"], "elton@example.com")
        self.assertTrue(response.json()["deviceToken"])
        self.owner.refresh_from_db()
        self.assertIsNotNone(self.owner.email_verified_at)
        self.assertEqual(DeviceSession.objects.filter(owner=self.owner).count(), 1)
        link = MagicLinkToken.objects.get(owner=self.owner)
        self.assertIsNotNone(link.used_at)

    def test_link_cannot_be_used_twice(self):
        token = self.get_token()
        self.assertEqual(self.verify(token).status_code, 200)

        response = self.verify(token)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_token")

    def test_expired_link_is_rejected(self):
        token = self.get_token()
        link = MagicLinkToken.objects.get(owner=self.owner)
        link.expires_at = timezone.now() - timedelta(minutes=1)
        link.save(update_fields=["expires_at"])

        response = self.verify(token)

        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "expired_token")

    def test_invalid_token_is_rejected(self):
        response = self.verify("x" * 32)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_token")

    def test_a_new_request_invalidates_the_old_link(self):
        first = self.get_token()
        second = self.get_token()

        self.assertNotEqual(first, second)
        self.assertEqual(self.verify(first).status_code, 400)
        self.assertEqual(self.verify(second).status_code, 200)

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.request_url).status_code, 405)
        self.assertEqual(self.client.get(self.verify_url).status_code, 405)


class RegisterStaffTests(TestCase):
    endpoint = "/api/v1/staff"
    pin_hash = "sha256$" + ("a" * 32) + "$" + ("b" * 64)

    def setUp(self):
        self.owner = Owner.objects.create(
            id="owner_1",
            name="Elton Chiwala",
            phone="0971234567",
            pin_hash=self.pin_hash,
        )
        self.token = issue_device_token(self.owner)

    def payload(self, **overrides):
        data = {
            "id": "staff_1",
            "ownerId": self.owner.id,
            "name": "Given Phiri",
            "phone": "096 555 1122",
            "pin": "7315",
            "pinHash": self.pin_hash,
        }
        data.update(overrides)
        return data

    def post(self, token=None, **overrides):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token or self.token}"}
        return self.client.post(
            self.endpoint,
            data=json.dumps(self.payload(**overrides)),
            content_type="application/json",
            **headers,
        )

    def test_registers_staff_under_the_owner(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        staff = Staff.objects.get()
        self.assertEqual(staff.owner, self.owner)
        self.assertEqual(staff.phone, "0965551122")
        self.assertEqual(staff.pin_hash, self.pin_hash)
        self.assertTrue(check_password("7315", staff.pin_verifier))
        self.assertEqual(
            response.json(),
            {"id": "staff_1", "name": "Given Phiri", "phone": "0965551122", "role": "staff"},
        )
        self.assertNotIn("pinHash", response.json())
        self.assertNotIn("pin_hash", response.json())
        self.assertNotIn("pin_verifier", response.json())

    def test_owner_must_be_signed_in(self):
        response = self.client.post(
            self.endpoint,
            data=json.dumps(self.payload()),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "unauthorized")
        self.assertEqual(Staff.objects.count(), 0)

    def test_another_owner_cannot_add_staff_to_this_shop(self):
        other = Owner.objects.create(
            id="owner_2",
            name="Another Owner",
            phone="0950000000",
            pin_hash=self.pin_hash,
        )
        other_token = issue_device_token(other)

        response = self.post(token=other_token)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "forbidden")
        self.assertEqual(Staff.objects.count(), 0)

    def test_retry_does_not_replace_the_staff_pin(self):
        self.post()
        before = Staff.objects.get()

        response = self.post(pin="9999", pinHash="sha256$" + ("c" * 32) + "$" + ("d" * 64))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Staff.objects.count(), 1)
        after = Staff.objects.get()
        self.assertEqual(after.pin_hash, before.pin_hash)
        self.assertTrue(check_password("7315", after.pin_verifier))

    def test_owner_phone_cannot_become_a_staff_login(self):
        response = self.post(phone="0971234567")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")

    def test_duplicate_staff_phone_is_rejected(self):
        self.post()
        response = self.post(id="staff_2")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
        self.assertEqual(Staff.objects.count(), 1)

    def test_staff_id_cannot_be_reused_for_another_phone(self):
        self.post()
        response = self.post(phone="095 111 2233")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "id_conflict")
        self.assertEqual(Staff.objects.count(), 1)

    def test_rejects_a_raw_pin_hash(self):
        response = self.post(pinHash="1234")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_rejects_a_missing_or_bad_pin(self):
        response = self.post(pin="12")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pin", response.json())

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.endpoint).status_code, 405)


class StaffSignInTests(TestCase):
    confirm_url = "/api/v1/auth/staff-sign-in/confirm"
    pin = "4821"

    def setUp(self):
        self.owner = Owner.objects.create(
            id="owner_1",
            name="Elton Chiwala",
            phone="0971234567",
            pin_hash="sha256$" + ("e" * 32) + "$" + ("f" * 64),
        )
        self.staff = Staff.objects.create(
            id="staff_1",
            owner=self.owner,
            name="Given Phiri",
            phone="0965551122",
            pin_hash="sha256$" + ("a" * 32) + "$" + ("b" * 64),
            pin_verifier=make_password(self.pin),
        )

    def confirm(self, pin, phone="0965551122"):
        return self.client.post(
            self.confirm_url,
            data=json.dumps({"phone": phone, "pin": pin}),
            content_type="application/json",
        )

    def test_confirm_signs_in_and_stamps_the_first_check(self):
        response = self.confirm(self.pin)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload["staff"],
            {
                "id": "staff_1",
                "name": "Given Phiri",
                "phone": "0965551122",
                "role": "staff",
            },
        )
        self.assertEqual(payload["owner"]["name"], "Elton Chiwala")
        self.assertEqual(payload["owner"]["phone"], "0971234567")
        self.assertNotIn("id", payload["owner"])
        self.assertNotIn("pinHash", payload["staff"])
        self.staff.refresh_from_db()
        self.assertIsNotNone(self.staff.first_signed_in_at)

    def test_wrong_pin_is_rejected_and_counted(self):
        response = self.confirm("0000")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.first_signed_in_at)
        self.assertEqual(self.staff.failed_sign_ins, 1)

    def test_five_wrong_pins_lock_the_staff_account(self):
        for _ in range(5):
            self.assertEqual(self.confirm("0000").status_code, 401)

        response = self.confirm(self.pin)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_attempts")
        self.staff.refresh_from_db()
        self.assertIsNotNone(self.staff.locked_until)

    def test_locked_account_stays_locked_until_the_window_passes(self):
        self.staff.locked_until = timezone.now() + timedelta(minutes=10)
        self.staff.save(update_fields=["locked_until"])

        response = self.confirm(self.pin)

        self.assertEqual(response.status_code, 429)

    def test_malformed_pin_is_a_field_error(self):
        response = self.confirm("not-a-pin")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pin", response.json())

    def test_unknown_phone_gets_a_generic_invalid_credentials(self):
        response = self.confirm(self.pin, phone="0951112233")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_a_legacy_staff_row_without_a_verifier_cannot_sign_in(self):
        self.staff.pin_verifier = ""
        self.staff.save(update_fields=["pin_verifier"])

        response = self.confirm(self.pin)

        self.assertEqual(response.status_code, 401)

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.confirm_url).status_code, 405)
