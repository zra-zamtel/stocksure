"""USSD sign-in: the caller's number picks the account and the first input is
that person's USSD PIN, which the owner sets in the app."""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.shops.models import Membership
from apps.ussd.models import UssdPin
from apps.ussd.services import PIN_LOCK_AFTER, handle

from .helpers import USSD_PIN, client_for, give_ussd_pins, make_shop

OWNER = "0977000001"
STAFF = "0977000002"


class UssdSignInTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        give_ussd_pins(self.owner, self.assistant)

    def test_the_first_screen_asks_for_the_pin(self):
        self.assertEqual(handle(OWNER, ""), "CON StockSure\nEnter your USSD PIN")

    def test_the_right_pin_opens_the_menu_for_the_role(self):
        owner_menu = handle(OWNER, USSD_PIN)
        self.assertTrue(owner_menu.startswith("CON Test Shoes"), owner_menu)
        self.assertIn("4. Tax estimate", owner_menu)
        staff_menu = handle(STAFF, USSD_PIN)
        self.assertIn("1. Record a sale", staff_menu)
        self.assertNotIn("Tax estimate", staff_menu)

    def test_a_wrong_pin_stops_the_session_and_does_nothing(self):
        answer = handle(STAFF, "0000*1*150*1")
        self.assertTrue(answer.startswith("END Wrong PIN."), answer)
        from apps.sync.models import Sale

        self.assertFalse(Sale.objects.exists())

    def test_a_staff_pin_does_not_open_the_owner_account(self):
        UssdPin.objects.filter(user=self.assistant).update(pin_hash=make_password("1111"))
        self.assertTrue(handle(OWNER, "1111").startswith("END Wrong PIN."))

    def test_five_wrong_pins_lock_dial_in_and_email_the_owner(self):
        self.owner.email = "owner@example.com"
        self.owner.email_verified_at = timezone.now()
        self.owner.save()
        for _ in range(PIN_LOCK_AFTER - 1):
            self.assertTrue(handle(STAFF, "0000").startswith("END Wrong PIN."))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertIn("locked", handle(STAFF, "0000"))

        # Locked: even the right PIN is refused until the lock runs out.
        self.assertIn("Too many wrong PINs", handle(STAFF, USSD_PIN))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(STAFF[1:], mail.outbox[0].body)

        UssdPin.objects.filter(user=self.assistant).update(
            locked_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertIn("1. Record a sale", handle(STAFF, USSD_PIN))

    def test_the_right_pin_resets_the_count(self):
        handle(STAFF, "0000")
        handle(STAFF, USSD_PIN)
        self.assertEqual(UssdPin.objects.get(user=self.assistant).failed_attempts, 0)

    def test_no_pin_yet_points_to_the_app(self):
        UssdPin.objects.all().delete()
        self.assertIn("Settings", handle(OWNER, ""))
        self.assertIn("Ask the shop owner", handle(STAFF, ""))

    def test_an_unknown_number_is_sent_to_the_app_and_nothing_is_created(self):
        self.assertIn("Sign up in the StockSure app", handle("0977999999", ""))
        self.assertIn("Sign up in the StockSure app", handle("0977999999", "1*My Shop*4321"))
        self.assertFalse(User.objects.filter(phone="260977999999").exists())

    def test_a_removed_staff_member_cannot_dial_in(self):
        Membership.objects.filter(user=self.assistant).update(is_active=False)
        self.assertIn("not linked to a shop", handle(STAFF, USSD_PIN))


@override_settings(USSD_SHARED_SECRET="gateway-secret")
class UssdPinApiTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        self.oc = client_for(self.owner)

    def test_the_owner_sets_their_own_pin_then_can_dial_in(self):
        response = self.oc.post("/api/v1/ussd/pin", {"pin": "2580"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["isSet"])
        self.assertIn("4. Tax estimate", handle(OWNER, "2580"))
        self.assertEqual(UssdPin.objects.get(user=self.owner).set_by, self.owner)

    def test_the_owner_sets_a_staff_pin(self):
        response = self.oc.post(
            "/api/v1/ussd/pin", {"pin": "3690", "userId": str(self.assistant.id)}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("1. Record a sale", handle(STAFF, "3690"))

    def test_a_new_pin_clears_a_lock(self):
        give_ussd_pins(self.assistant)
        UssdPin.objects.filter(user=self.assistant).update(
            locked_until=timezone.now() + timedelta(minutes=10), failed_attempts=3
        )
        self.oc.post(
            "/api/v1/ussd/pin", {"pin": "3690", "userId": str(self.assistant.id)}, format="json"
        )
        self.assertIn("1. Record a sale", handle(STAFF, "3690"))

    def test_the_pin_must_be_four_digits(self):
        for pin in ["123", "12345", "12a4", ""]:
            response = self.oc.post("/api/v1/ussd/pin", {"pin": pin}, format="json")
            self.assertEqual(response.status_code, 400, pin)

    def test_an_owner_cannot_set_another_shops_staff_pin(self):
        stranger = User.objects.create_user("0977123123", "pass", full_name="Stranger")
        response = self.oc.post(
            "/api/v1/ussd/pin", {"pin": "3690", "userId": str(stranger.id)}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(UssdPin.objects.filter(user=stranger).exists())

    def test_staff_cannot_set_pins(self):
        response = client_for(self.assistant).post(
            "/api/v1/ussd/pin", {"pin": "3690", "userId": str(self.owner.id)}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        response = client_for(self.assistant).post("/api/v1/ussd/pin", {"pin": "3690"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(client_for(self.assistant).get("/api/v1/ussd/pins").status_code, 403)

    def test_status_lists_the_owner_and_staff(self):
        give_ussd_pins(self.assistant)
        pins = {row["userId"]: row for row in self.oc.get("/api/v1/ussd/pins").json()["pins"]}
        self.assertFalse(pins[str(self.owner.id)]["isSet"])
        self.assertTrue(pins[str(self.assistant.id)]["isSet"])

    def test_turning_dial_in_off(self):
        give_ussd_pins(self.assistant)
        response = self.oc.delete(f"/api/v1/ussd/pin?userId={self.assistant.id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(UssdPin.objects.filter(user=self.assistant).exists())
        self.assertIn("Ask the shop owner", handle(STAFF, ""))

    def test_needs_sign_in(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().post("/api/v1/ussd/pin", {"pin": "1234"}).status_code, 401)
