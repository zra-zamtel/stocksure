import json
import re
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import EmailCode, PinResetCode, StaffProfile, User
from apps.accounts.views import issue_email_code
from apps.shops.models import Membership, Shop

PIN_HASH = "sha256$" + ("a" * 32) + "$" + ("b" * 64)


def token_for(user):
    return str(RefreshToken.for_user(user).access_token)


def auth(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {token_for(user)}"}


def make_owner(
    email="elton@example.com",
    phone="0971234567",
    password="correct horse battery",
    verified=True,
    shop=True,
):
    user = User.objects.create_user(
        phone, password, full_name="Elton Chiwala", email=email
    )
    if verified:
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
    shop_row = None
    if shop:
        shop_row = Shop.objects.create(owner=user, name="Test Shoes", town="Kabwe")
        Membership.objects.create(user=user, shop=shop_row, role=Membership.Role.OWNER)
    return user, shop_row


def make_staff(owner, phone="0965551122", pin="1234", client_id=None):
    shop = Membership.objects.get(user=owner, role=Membership.Role.OWNER).shop
    user = User.objects.create_user(phone, None, full_name="Given")
    Membership.objects.create(user=user, shop=shop, role=Membership.Role.ASSISTANT)
    profile = StaffProfile.objects.create(
        user=user, client_id=client_id, pin_verifier=make_password(pin)
    )
    return user, shop, profile


class AuthTestCase(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, path, body, headers=None):
        return self.client.post(
            path,
            data=json.dumps(body),
            content_type="application/json",
            **(headers or {}),
        )


class RegisterOwnerTests(AuthTestCase):
    endpoint = "/api/v1/auth/register"

    def payload(self, **overrides):
        data = {
            "id": "owner_1",
            "name": "Elton Chiwala",
            "phone": "097 123 4567",
            "email": "elton@example.com",
            "password": "correct horse battery",
            "pinHash": PIN_HASH,
        }
        data.update(overrides)
        return data

    def post_register(self, **overrides):
        return self.post(self.endpoint, self.payload(**overrides))

    def test_registers_owner_and_returns_jwt_and_owner_shape(self):
        response = self.post_register()

        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get()
        self.assertEqual(user.phone, "260971234567")
        self.assertEqual(user.email, "elton@example.com")
        self.assertTrue(user.check_password("correct horse battery"))
        self.assertFalse(hasattr(user, "pin_hash"))
        self.assertTrue(
            Membership.objects.filter(
                user=user, role=Membership.Role.OWNER
            ).exists()
        )
        payload = response.json()
        self.assertEqual(
            payload["owner"],
            {
                "id": str(user.id),
                "name": "Elton Chiwala",
                "phone": "260971234567",
                "email": "elton@example.com",
            },
        )
        self.assertTrue(payload["deviceToken"])
        self.assertEqual(payload["deviceToken"], payload["access"])
        self.assertTrue(payload["refresh"])
        self.assertNotIn("password", payload)
        self.assertNotIn("pinHash", payload)

    def test_registration_emails_a_confirmation_code(self):
        response = self.post_register()

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["verificationSent"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["elton@example.com"])
        self.assertIn("Elton Chiwala", mail.outbox[0].body)
        self.assertNotIn("://", mail.outbox[0].body)
        html, mimetype = mail.outbox[0].alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn("StockSure", html)
        self.assertNotIn("<a ", html)
        match = re.search(r"\b(\d{6})\b", mail.outbox[0].body)
        self.assertIsNotNone(match)
        verify = self.post(
            "/api/v1/auth/email-code/verify",
            {"email": "elton@example.com", "code": match.group(1)},
        )
        self.assertEqual(verify.status_code, 200)
        self.assertIsNotNone(User.objects.get().email_verified_at)

    @patch("apps.accounts.emails.send_mail", side_effect=Exception("smtp down"))
    def test_registration_succeeds_when_email_delivery_fails(self, _send_mail):
        response = self.post_register()

        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email="elton@example.com").exists())
        self.assertFalse(response.json()["verificationSent"])

    def test_normalises_an_international_phone(self):
        response = self.post_register(phone="+260 97 123 4567")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(phone="260971234567").exists())

    def test_lowercases_the_email(self):
        response = self.post_register(email="  ELTON@Example.COM ")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get().email, "elton@example.com")

    def test_duplicate_phone_gets_a_clear_conflict(self):
        self.post_register()
        response = self.post_register(id="owner_2", email="other@example.com")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")
        self.assertEqual(User.objects.count(), 1)

    def test_duplicate_verified_email_gets_a_clear_conflict(self):
        self.post_register()
        User.objects.update(email_verified_at=timezone.now())
        response = self.post_register(id="owner_2", phone="096 555 1122")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "email_taken")
        self.assertEqual(User.objects.count(), 1)

    def test_a_new_registration_replaces_an_unverified_email_claim(self):
        self.post_register()
        response = self.post_register(id="owner_2", phone="096 555 1122")

        self.assertEqual(response.status_code, 201)
        old = User.objects.get(client_id="owner_1")
        new = User.objects.get(client_id="owner_2")
        self.assertEqual(old.email, "")
        self.assertEqual(new.email, "elton@example.com")
        self.assertEqual(User.objects.count(), 2)

    def test_a_staff_phone_cannot_become_an_owner_login(self):
        owner, _ = make_owner()
        make_staff(owner, phone="0965551122")
        response = self.post_register(
            id="owner_2", phone="096 555 1122", email="other@example.com"
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")

    def test_retry_with_same_credentials_is_idempotent(self):
        first = self.post_register()
        second = self.post_register()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["owner"]["id"], first.json()["owner"]["id"])
        self.assertEqual(User.objects.count(), 1)

    def test_a_retry_after_the_window_cannot_mint_another_token(self):
        first = self.post_register()
        user = User.objects.get()
        user.date_joined = timezone.now() - timedelta(minutes=11)
        user.save(update_fields=["date_joined"])

        second = self.post_register()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "account_conflict")

    def test_retry_cannot_change_credentials(self):
        self.post_register()
        response = self.post_register(password="a different password")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "account_conflict")
        user = User.objects.get()
        self.assertTrue(user.check_password("correct horse battery"))

    def test_id_conflict_is_reported(self):
        self.post_register()
        response = self.post_register(phone="096 555 1122", email="other@example.com")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "id_conflict")

    def test_rejects_a_short_password(self):
        response = self.post_register(password="short")

        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())

    def test_rejects_a_bad_email(self):
        response = self.post_register(email="not-an-email")

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.json())

    def test_rejects_a_raw_pin(self):
        response = self.post_register(pinHash="1234")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_rejects_a_bad_phone(self):
        response = self.post_register(phone="123")

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())

    def test_domain_path_also_accepts_a_shop_name(self):
        response = self.post(
            "/api/auth/register/",
            {
                "name": "Domain Owner",
                "phone": "0977000009",
                "email": "domain@example.com",
                "password": "correct horse battery",
                "shop_name": "Domain Shop",
            },
        )

        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email="domain@example.com")
        self.assertTrue(Shop.objects.filter(owner=user, name="Domain Shop").exists())
        self.assertTrue(
            Membership.objects.filter(user=user, role=Membership.Role.OWNER).exists()
        )


class OwnerLoginTests(AuthTestCase):
    login_url = "/api/v1/auth/login"
    device_pin_url = "/api/v1/auth/device-pin"

    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner()

    def login(self, **overrides):
        body = {"email": "elton@example.com", "password": "correct horse battery"}
        body.update(overrides)
        return self.post(self.login_url, body)

    def test_login_returns_owner_and_tokens(self):
        response = self.login()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["owner"]["email"], "elton@example.com")
        self.assertTrue(payload["deviceToken"])
        self.assertTrue(payload["access"])
        self.assertTrue(payload["refresh"])
        self.assertNotIn("password", payload)

    def test_email_is_case_insensitive(self):
        self.assertEqual(self.login(email="  ELTON@Example.COM ").status_code, 200)

    def test_phone_login_is_supported_for_domain_clients(self):
        response = self.post(
            self.login_url, {"phone": "0971234567", "password": "correct horse battery"}
        )

        self.assertEqual(response.status_code, 200)

    def test_wrong_password_is_rejected(self):
        response = self.login(password="wrong password")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_unknown_email_is_rejected(self):
        response = self.login(email="nobody@example.com")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_unverified_email_cannot_use_password_login(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])

        response = self.login()

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "email_unverified")

    def test_unverified_login_with_the_right_password_emails_a_confirmation_code(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])
        mail.outbox.clear()

        response = self.login()

        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json()["verificationSent"])
        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["elton@example.com"])
        self.assertEqual(
            EmailCode.objects.filter(user=self.owner, used_at__isnull=True).count(), 1
        )

    @override_settings(EXPOSE_EMAIL_TOKEN=True)
    def test_unverified_login_code_verifies_the_email_and_signs_in(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])

        code = self.login().json()["demoCode"]
        verified = self.post(
            "/api/v1/auth/email-code/verify", {"email": "elton@example.com", "code": code}
        )

        self.assertEqual(verified.status_code, 200, verified.content)
        self.owner.refresh_from_db()
        self.assertIsNotNone(self.owner.email_verified_at)
        self.assertEqual(self.login().status_code, 200)

    def test_a_wrong_password_for_an_unverified_owner_sends_nothing(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])
        mail.outbox.clear()

        self.login(password="wrong password")

        self.assertEqual(len(mail.outbox), 0)

    def test_a_wrong_password_for_an_unverified_owner_stays_generic(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])

        response = self.login(password="wrong password")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_a_user_without_a_usable_password_cannot_log_in(self):
        self.owner.set_unusable_password()
        self.owner.save(update_fields=["password"])

        self.assertEqual(self.login().status_code, 401)

    def test_device_pin_accepts_the_jwt_and_does_not_store_the_hash(self):
        self.login().json()["deviceToken"]

        response = self.post(
            self.device_pin_url, {"pinHash": PIN_HASH}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "elton@example.com")
        self.assertNotIn("pinHash", response.json())

    def test_device_pin_requires_a_token(self):
        response = self.post(self.device_pin_url, {"pinHash": PIN_HASH})

        self.assertEqual(response.status_code, 401)
        self.assertIn("detail", response.json())

    def test_a_bad_token_is_rejected(self):
        response = self.post(
            self.device_pin_url,
            {"pinHash": PIN_HASH},
            {"HTTP_AUTHORIZATION": "Bearer not-a-real-token"},
        )

        self.assertEqual(response.status_code, 401)

    def test_device_pin_rejects_a_raw_pin(self):
        response = self.post(
            self.device_pin_url, {"pinHash": "1234"}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pinHash", response.json())

    def test_logout_blacklists_the_refresh_token(self):
        tokens = self.login().json()
        response = self.post(
            "/api/v1/auth/logout",
            {"refresh": tokens["refresh"]},
            {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"},
        )
        self.assertEqual(response.status_code, 200)

        refresh = self.post("/api/v1/auth/refresh", {"refresh": tokens["refresh"]})
        self.assertEqual(refresh.status_code, 401)

    def test_refresh_rotates_the_tokens(self):
        tokens = self.login().json()

        response = self.post("/api/v1/auth/refresh", {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["access"])
        self.assertNotEqual(response.json()["refresh"], tokens["refresh"])

        reused = self.post("/api/v1/auth/refresh", {"refresh": tokens["refresh"]})
        self.assertEqual(reused.status_code, 401)


@override_settings(EXPOSE_EMAIL_TOKEN=True)
class EmailCodeTests(AuthTestCase):
    request_url = "/api/v1/auth/email-code/request"
    verify_url = "/api/v1/auth/email-code/verify"

    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner(verified=False)

    def request_code(self, email="elton@example.com", phone="0971234567"):
        body = {"email": email}
        if phone is not None:
            body["phone"] = phone
        return self.post(self.request_url, body)

    def verify(self, code, email="elton@example.com"):
        return self.post(self.verify_url, {"email": email, "code": code})

    def test_request_emails_a_six_digit_code(self):
        response = self.request_code()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["elton@example.com"])
        code = response.json()["demoCode"]
        self.assertRegex(code, r"^\d{6}$")
        self.assertIn(code, mail.outbox[0].body)

    def test_an_unverified_owner_must_supply_the_phone_number(self):
        response = self.request_code(phone=None)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_a_wrong_phone_sends_nothing(self):
        response = self.request_code(phone="0970000000")

        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_unknown_email_gets_the_same_generic_response_without_sending(self):
        response = self.request_code(email="nobody@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_a_confirmed_email_is_not_sent_another_code(self):
        self.owner.email_verified_at = timezone.now()
        self.owner.save(update_fields=["email_verified_at"])

        response = self.request_code()

        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_verify_confirms_the_email_and_returns_tokens(self):
        code = self.request_code().json()["demoCode"]

        response = self.verify(code)

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())
        self.assertIn("deviceToken", response.json())
        self.owner.refresh_from_db()
        self.assertIsNotNone(self.owner.email_verified_at)
        login = self.post(
            "/api/v1/auth/login",
            {"email": "elton@example.com", "password": "correct horse battery"},
        )
        self.assertEqual(login.status_code, 200)

    def test_code_cannot_be_used_twice(self):
        code = self.request_code().json()["demoCode"]
        self.assertEqual(self.verify(code).status_code, 200)

        second = self.verify(code)

        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["code"], "invalid_code")

    def test_expired_code_is_rejected(self):
        code = self.request_code().json()["demoCode"]
        EmailCode.objects.update(expires_at=timezone.now() - timedelta(minutes=1))

        response = self.verify(code)

        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "expired_code")

    def test_wrong_codes_lock_after_five_tries(self):
        code = self.request_code().json()["demoCode"]
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(4):
            self.assertEqual(self.verify(wrong).json()["code"], "invalid_code")

        self.assertEqual(self.verify(wrong).status_code, 429)
        self.assertEqual(self.verify(code).status_code, 429)

    def test_a_new_request_invalidates_the_old_code(self):
        first = self.request_code().json()["demoCode"]
        second = self.request_code().json()["demoCode"]

        if first != second:
            self.assertEqual(self.verify(first).status_code, 400)
        self.assertEqual(self.verify(second).status_code, 200)

    def test_a_code_for_another_email_is_rejected(self):
        code = self.request_code().json()["demoCode"]

        self.assertEqual(self.verify(code, email="other@example.com").status_code, 400)


@override_settings(EXPOSE_EMAIL_TOKEN=True)
class PasswordResetTests(AuthTestCase):
    request_url = "/api/v1/auth/password-reset/request"
    confirm_url = "/api/v1/auth/password-reset/confirm"

    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner()

    def test_reset_sets_the_new_password_and_notifies_the_owner(self):
        code = self.post(self.request_url, {"email": "elton@example.com"}).json()["demoCode"]
        mail.outbox.clear()

        response = self.post(
            self.confirm_url,
            {"email": "elton@example.com", "code": code, "password": "a brand new pass"},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("deviceToken", response.json())
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password("a brand new pass"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("password", mail.outbox[0].subject)

    def test_unconfirmed_email_gets_no_reset_code(self):
        self.owner.email_verified_at = None
        self.owner.save(update_fields=["email_verified_at"])

        response = self.post(self.request_url, {"email": "elton@example.com"})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("demoCode", response.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_a_confirmation_code_cannot_reset_the_password(self):
        _, code = issue_email_code(self.owner, EmailCode.Purpose.VERIFY)

        response = self.post(
            self.confirm_url,
            {"email": "elton@example.com", "code": code, "password": "a brand new pass"},
        )

        self.assertEqual(response.status_code, 400)


@override_settings(EXPOSE_RESET_CODE=True)
class PinResetTests(AuthTestCase):
    request_url = "/api/v1/auth/pin-reset/request"
    confirm_url = "/api/v1/auth/pin-reset/confirm"

    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner()

    def request_code(self, phone="0971234567"):
        return self.post(self.request_url, {"phone": phone})

    def confirm(self, code, phone="0971234567", pin_hash=PIN_HASH):
        return self.post(
            self.confirm_url,
            {"phone": phone, "code": code, "pinHash": pin_hash},
        )

    def test_request_returns_a_demo_code_and_stores_only_its_hash(self):
        response = self.request_code()

        self.assertEqual(response.status_code, 200)
        code = response.json()["demoCode"]
        self.assertRegex(code, r"^\d{6}$")
        reset = PinResetCode.objects.get(user=self.owner)
        self.assertTrue(check_password(code, reset.code_hash))
        self.assertNotEqual(reset.code_hash, code)

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

    def test_confirm_marks_the_code_used(self):
        code = self.request_code().json()["demoCode"]

        response = self.confirm(code)

        self.assertEqual(response.status_code, 200)
        reset = PinResetCode.objects.get(user=self.owner)
        self.assertIsNotNone(reset.used_at)
        self.assertNotIn("pinHash", response.json())

    def test_wrong_code_counts_an_attempt(self):
        code = self.request_code().json()["demoCode"]
        wrong = "000000" if code != "000000" else "111111"

        response = self.confirm(wrong)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_code")
        self.assertEqual(PinResetCode.objects.get(user=self.owner).attempts, 1)

    def test_too_many_attempts_requires_a_new_code(self):
        code = self.request_code().json()["demoCode"]
        wrong = "000000" if code != "000000" else "111111"

        for _ in range(4):
            self.assertEqual(self.confirm(wrong).status_code, 400)

        response = self.confirm(wrong)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_attempts")

    def test_expired_code_is_rejected(self):
        code = self.request_code().json()["demoCode"]
        reset = PinResetCode.objects.get(user=self.owner)
        reset.expires_at = timezone.now() - timedelta(minutes=1)
        reset.save(update_fields=["expires_at"])

        response = self.confirm(code)

        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "expired_code")

    def test_a_new_request_invalidates_the_previous_code(self):
        with patch("apps.accounts.views.secrets.randbelow", side_effect=[0, 1]):
            first = self.request_code().json()["demoCode"]
            second = self.request_code().json()["demoCode"]

        self.assertEqual(first, "100000")
        self.assertEqual(second, "100001")
        self.assertEqual(self.confirm(first).status_code, 400)
        self.assertEqual(self.confirm(second).status_code, 200)

    def test_confirm_rejects_a_raw_pin(self):
        code = self.request_code().json()["demoCode"]

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


class StaffTests(AuthTestCase):
    sign_in_url = "/api/v1/auth/staff-sign-in/confirm"

    def setUp(self):
        super().setUp()
        self.owner, self.shop = make_owner()

    def add_staff(self, **overrides):
        body = {
            "id": "staff_1",
            "ownerId": str(self.owner.id),
            "name": "Given",
            "phone": "0965551122",
            "pin": "1234",
        }
        body.update(overrides)
        return self.post("/api/v1/auth/staff", body, auth(self.owner))

    def test_registers_staff_under_the_owner(self):
        response = self.add_staff()

        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(phone="260965551122")
        self.assertTrue(
            Membership.objects.filter(
                user=user, shop=self.shop, role=Membership.Role.ASSISTANT
            ).exists()
        )
        self.assertTrue(check_password("1234", user.staff_profile.pin_verifier))
        self.assertEqual(response.json()["role"], "staff")
        self.assertNotIn("pin", response.json())

    def test_adding_staff_emails_the_owner_a_notice(self):
        mail.outbox.clear()

        self.add_staff()

        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("staff member was added", mail.outbox[0].subject)
        self.assertIn("260965551122", mail.outbox[0].body)

    def test_owner_must_be_signed_in(self):
        response = self.post(
            "/api/v1/auth/staff",
            {"name": "Given", "phone": "0965551122", "pin": "1234"},
        )

        self.assertEqual(response.status_code, 401)

    def test_an_assistant_cannot_add_staff(self):
        staff, _, _ = make_staff(self.owner)

        response = self.post(
            "/api/v1/auth/staff",
            {"name": "Another", "phone": "0965551133", "pin": "1234"},
            auth(staff),
        )

        self.assertEqual(response.status_code, 403)

    def test_retry_does_not_replace_the_staff_pin(self):
        self.add_staff()
        response = self.add_staff(pin="5678")

        self.assertEqual(response.status_code, 200)
        user = User.objects.get(phone="260965551122")
        self.assertTrue(check_password("1234", user.staff_profile.pin_verifier))
        self.assertFalse(check_password("5678", user.staff_profile.pin_verifier))

    def test_owner_phone_cannot_become_a_staff_login(self):
        response = self.add_staff(phone="0971234567")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")

    def test_duplicate_staff_phone_is_rejected(self):
        self.add_staff()
        response = self.add_staff(id="staff_2", phone="0965551122")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "phone_taken")

    def test_staff_id_cannot_be_reused_for_another_phone(self):
        self.add_staff()
        response = self.add_staff(phone="0965551133")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "id_conflict")

    def test_rejects_a_missing_or_bad_pin(self):
        response = self.add_staff(pin="12")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pin", response.json())

    def test_first_sign_in_asks_for_a_new_pin(self):
        self.add_staff()

        response = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["staff"]["role"], "staff")
        self.assertTrue(response.json()["mustChangePin"])
        user = User.objects.get(phone="260965551122")
        self.assertIsNone(user.staff_profile.first_signed_in_at)

    def test_choosing_a_new_pin_replaces_the_owner_pin(self):
        self.add_staff()

        response = self.post(
            self.sign_in_url, {"phone": "0965551122", "pin": "1234", "newPin": "8642"}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["mustChangePin"])
        profile = User.objects.get(phone="260965551122").staff_profile
        self.assertIsNotNone(profile.first_signed_in_at)
        self.assertTrue(check_password("8642", profile.pin_verifier))
        old = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"})
        self.assertEqual(old.status_code, 401)
        again = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "8642"})
        self.assertFalse(again.json()["mustChangePin"])

    def test_the_new_pin_must_differ_from_the_owner_pin(self):
        self.add_staff()

        response = self.post(
            self.sign_in_url, {"phone": "0965551122", "pin": "1234", "newPin": "1234"}
        )

        self.assertEqual(response.status_code, 400)

    def test_a_wrong_owner_pin_cannot_set_a_new_pin(self):
        self.add_staff()

        response = self.post(
            self.sign_in_url, {"phone": "0965551122", "pin": "9999", "newPin": "8642"}
        )

        self.assertEqual(response.status_code, 401)
        profile = User.objects.get(phone="260965551122").staff_profile
        self.assertTrue(check_password("1234", profile.pin_verifier))

    def test_wrong_pin_is_rejected_and_counted(self):
        self.add_staff()

        response = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "9999"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")
        user = User.objects.get(phone="260965551122")
        self.assertEqual(user.staff_profile.failed_sign_ins, 1)

    def test_five_wrong_pins_lock_the_staff_account(self):
        self.add_staff()
        for _ in range(5):
            self.post(self.sign_in_url, {"phone": "0965551122", "pin": "9999"})

        response = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_attempts")

        profile = StaffProfile.objects.get(user__phone="260965551122")
        profile.locked_until = timezone.now() - timedelta(minutes=1)
        profile.save(update_fields=["locked_until"])
        self.assertEqual(
            self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"}).status_code,
            200,
        )

    def test_known_phone_is_required(self):
        response = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

    def test_owner_replaces_the_staff_pin(self):
        self.add_staff()
        staff = User.objects.get(phone="260965551122")

        response = self.post(
            f"/api/v1/auth/staff/{staff.id}/pin-reset", {"pin": "5678"}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.post(self.sign_in_url, {"phone": "0965551122", "pin": "1234"}).status_code,
            401,
        )
        self.assertEqual(
            self.post(self.sign_in_url, {"phone": "0965551122", "pin": "5678"}).status_code,
            200,
        )

    def test_another_owner_cannot_reset_this_staff_pin(self):
        self.add_staff()
        staff = User.objects.get(phone="260965551122")
        other, _ = make_owner(
            email="other@example.com", phone="0977000007", shop=True
        )

        response = self.post(
            f"/api/v1/auth/staff/{staff.id}/pin-reset", {"pin": "5678"}, auth(other)
        )

        self.assertEqual(response.status_code, 404)

    def test_unknown_staff_id_is_not_found(self):
        response = self.post(
            "/api/v1/auth/staff/999999/pin-reset", {"pin": "5678"}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 404)

    def test_rejects_a_bad_new_pin(self):
        self.add_staff()
        staff = User.objects.get(phone="260965551122")

        response = self.post(
            f"/api/v1/auth/staff/{staff.id}/pin-reset", {"pin": "12"}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pin", response.json())


class PathCompatibilityTests(AuthTestCase):
    def test_mobile_and_domain_paths_both_resolve(self):
        body = {
            "name": "Path Owner",
            "phone": "0977000011",
            "email": "paths@example.com",
            "password": "correct horse battery",
        }
        self.assertEqual(self.post("/api/v1/auth/register", body).status_code, 201)

        body["email"] = "paths2@example.com"
        body["phone"] = "0977000012"
        self.assertEqual(self.post("/api/auth/register/", body).status_code, 201)


class RegisterOwnerEdgeTests(AuthTestCase):
    endpoint = "/api/v1/auth/register"

    def payload(self, **overrides):
        data = {
            "name": "Elton Chiwala",
            "phone": "097 123 4567",
            "email": "elton@example.com",
            "password": "correct horse battery",
        }
        data.update(overrides)
        return data

    def test_reports_every_missing_field(self):
        response = self.post(self.endpoint, {})

        self.assertEqual(response.status_code, 400)
        for field in ("name", "phone", "email", "password"):
            self.assertIn(field, response.json())

    def test_rejects_a_blank_name(self):
        response = self.post(self.endpoint, self.payload(name=" "))

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_trims_the_name(self):
        response = self.post(self.endpoint, self.payload(name="  Elton  "))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get().full_name, "Elton")

    def test_rejects_malformed_json(self):
        response = self.client.post(
            self.endpoint, data="{", content_type="application/json"
        )

        self.assertEqual(response.status_code, 400)

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.endpoint).status_code, 405)

    def test_never_returns_the_pin_hash_on_a_retry(self):
        body = self.payload(id="owner_1")
        self.post(self.endpoint, body)
        second = self.post(self.endpoint, body)

        self.assertEqual(second.status_code, 200)
        self.assertNotIn("pinHash", second.json())

    def test_two_spellings_of_one_number_are_one_account(self):
        self.post(self.endpoint, self.payload())
        second = self.post(
            self.endpoint,
            self.payload(phone="+260 97 123 4567", email="other@example.com"),
        )

        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "phone_taken")
        self.assertEqual(User.objects.count(), 1)


class MoreOwnerLoginTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner()

    def login_tokens(self):
        return self.post(
            "/api/v1/auth/login",
            {"email": "elton@example.com", "password": "correct horse battery"},
        ).json()

    def test_refresh_requires_a_token(self):
        self.assertEqual(self.post("/api/v1/auth/refresh", {}).status_code, 400)

    def test_me_returns_the_signed_in_user(self):
        tokens = self.login_tokens()

        response = self.client.get(
            "/api/v1/auth/me", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "elton@example.com")

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_login_and_device_pin_only_accept_post(self):
        self.assertEqual(self.client.get("/api/v1/auth/login").status_code, 405)
        self.assertEqual(
            self.client.get("/api/v1/auth/device-pin", **auth(self.owner)).status_code,
            405,
        )


class MorePinResetTests(AuthTestCase):
    request_url = "/api/v1/auth/pin-reset/request"
    confirm_url = "/api/v1/auth/pin-reset/confirm"

    def setUp(self):
        super().setUp()
        self.owner, _ = make_owner()

    def test_only_accepts_post(self):
        self.assertEqual(self.client.get(self.request_url).status_code, 405)
        self.assertEqual(self.client.get(self.confirm_url).status_code, 405)

    @override_settings(EXPOSE_RESET_CODE=True)
    def test_a_reset_does_not_store_the_new_pin_hash(self):
        code = self.post(self.request_url, {"phone": "0971234567"}).json()["demoCode"]

        response = self.post(
            self.confirm_url,
            {"phone": "0971234567", "code": code, "pinHash": PIN_HASH},
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("pinHash", response.json())
        self.assertFalse(hasattr(User.objects.get(), "pin_hash"))


class MoreStaffTests(AuthTestCase):
    sign_in_url = "/api/v1/auth/staff-sign-in/confirm"

    def setUp(self):
        super().setUp()
        self.owner, self.shop = make_owner()

    def add_staff(self):
        response = self.post(
            "/api/v1/auth/staff",
            {
                "id": "staff_1",
                "ownerId": str(self.owner.id),
                "name": "Given",
                "phone": "0965551122",
                "pin": "1234",
            },
            auth(self.owner),
        )
        self.assertEqual(response.status_code, 201, response.content)
        return User.objects.get(phone="260965551122")

    def test_reset_clears_a_lock_and_failed_sign_ins(self):
        staff = self.add_staff()
        profile = staff.staff_profile
        profile.failed_sign_ins = 4
        profile.locked_until = timezone.now() + timedelta(minutes=10)
        profile.save(update_fields=["failed_sign_ins", "locked_until"])

        response = self.post(
            f"/api/v1/auth/staff/{staff.id}/pin-reset", {"pin": "5678"}, auth(self.owner)
        )

        self.assertEqual(response.status_code, 200)
        profile.refresh_from_db()
        self.assertEqual(profile.failed_sign_ins, 0)
        self.assertIsNone(profile.locked_until)
        self.assertEqual(
            self.post(self.sign_in_url, {"phone": "0965551122", "pin": "5678"}).status_code,
            200,
        )

    def test_owner_must_be_signed_in_to_reset_a_pin(self):
        staff = self.add_staff()

        response = self.post(f"/api/v1/auth/staff/{staff.id}/pin-reset", {"pin": "5678"})

        self.assertEqual(response.status_code, 401)

    def test_staff_endpoints_only_accept_post(self):
        staff = self.add_staff()
        self.assertEqual(
            self.client.get("/api/v1/auth/staff", **auth(self.owner)).status_code, 405
        )
        self.assertEqual(
            self.client.get(
                f"/api/v1/auth/staff/{staff.id}/pin-reset", **auth(self.owner)
            ).status_code,
            405,
        )
        self.assertEqual(self.client.get(self.sign_in_url).status_code, 405)

    def test_malformed_pin_is_a_field_error(self):
        self.add_staff()

        response = self.post(self.sign_in_url, {"phone": "0965551122", "pin": "12ab"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("pin", response.json())

    def test_a_staff_row_without_a_verifier_cannot_sign_in(self):
        user = User.objects.create_user("0965551133", None, full_name="No Pin")
        Membership.objects.create(
            user=user, shop=self.shop, role=Membership.Role.ASSISTANT
        )
        StaffProfile.objects.create(user=user)

        response = self.post(self.sign_in_url, {"phone": "0965551133", "pin": "1234"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "invalid_credentials")

