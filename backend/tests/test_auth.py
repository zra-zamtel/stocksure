from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User

from .helpers import BaseTestCase, authed, login, register


class RegisterAndLoginTests(BaseTestCase):
    def test_register_creates_owner_and_returns_tokens(self):
        client, data = register()
        self.assertEqual(data["user"]["role"], "owner")
        self.assertEqual(data["user"]["id"], "owner_a")
        self.assertEqual(data["user"]["phone"], "260977000001")
        self.assertEqual(client.get("/api/v1/auth/me").data["name"], "Owner A")

    def test_pin_is_hashed_never_stored(self):
        register(pin="1234")
        user = User.objects.get(phone="260977000001")
        self.assertNotIn("1234", user.password)
        self.assertTrue(user.check_password("1234"))

    def test_duplicate_phone_gets_a_clear_error(self):
        register()
        r = APIClient().post("/api/v1/auth/register",
                             {"name": "Other", "phone": "+260 977 000 001", "pin": "9999"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "phone_taken")
        self.assertIn("already registered", r.data["detail"])

    def test_pin_must_be_4_to_6_digits(self):
        for bad in ("123", "1234567", "12ab"):
            r = APIClient().post("/api/v1/auth/register",
                                 {"name": "X", "phone": "0977111111", "pin": bad}, format="json")
            self.assertEqual(r.status_code, 400, bad)

    def test_login_and_wrong_pin(self):
        register()
        self.assertEqual(APIClient().post("/api/v1/auth/login", {"phone": "0977000001", "pin": "1234"},
                                          format="json").status_code, 200)
        r = APIClient().post("/api/v1/auth/login", {"phone": "0977000001", "pin": "0000"}, format="json")
        self.assertEqual(r.status_code, 401)
        r = APIClient().post("/api/v1/auth/login", {"phone": "0977999999", "pin": "0000"}, format="json")
        self.assertEqual(r.status_code, 401)  # unknown phone looks the same as a wrong PIN

    def test_account_locks_after_five_wrong_pins(self):
        register()
        c = APIClient()
        codes = [c.post("/api/v1/auth/login", {"phone": "0977000001", "pin": "0000"}, format="json").status_code
                 for _ in range(5)]
        self.assertEqual(codes, [401, 401, 401, 401, 429])
        r = c.post("/api/v1/auth/login", {"phone": "0977000001", "pin": "1234"}, format="json")
        self.assertEqual(r.status_code, 429)  # even the right PIN is refused while locked
        self.assertEqual(r.data["code"], "locked")

    def test_change_pin(self):
        client, _ = register()
        self.assertEqual(client.post("/api/v1/auth/change-pin", {"old_pin": "9999", "new_pin": "4321"},
                                     format="json").status_code, 401)
        self.assertEqual(client.post("/api/v1/auth/change-pin", {"old_pin": "1234", "new_pin": "4321"},
                                     format="json").status_code, 200)
        login("0977000001", "4321")

    def test_protected_endpoints_need_a_token(self):
        self.assertEqual(APIClient().get("/api/v1/auth/me").status_code, 401)
        self.assertEqual(APIClient().get("/api/v1/sync/pull").status_code, 401)


@override_settings(PIN_RESET_RETURN_CODE=True)
class PinResetTests(BaseTestCase):
    def test_forgotten_pin_flow(self):
        register()
        c = APIClient()
        r = c.post("/api/v1/auth/pin-reset/request", {"phone": "0977000001"}, format="json")
        self.assertEqual(r.status_code, 202)
        code = r.data["devCode"]
        bad = c.post("/api/v1/auth/pin-reset/confirm",
                     {"phone": "0977000001", "code": "000000", "new_pin": "5555"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = c.post("/api/v1/auth/pin-reset/confirm",
                    {"phone": "0977000001", "code": code, "new_pin": "5555"}, format="json")
        self.assertEqual(ok.status_code, 200)
        login("0977000001", "5555")
        self.assertEqual(APIClient().post("/api/v1/auth/login", {"phone": "0977000001", "pin": "1234"},
                                          format="json").status_code, 401)
        # a code works once
        again = c.post("/api/v1/auth/pin-reset/confirm",
                       {"phone": "0977000001", "code": code, "new_pin": "6666"}, format="json")
        self.assertEqual(again.status_code, 400)

    def test_unknown_phone_gets_the_same_answer_but_no_code(self):
        r = APIClient().post("/api/v1/auth/pin-reset/request", {"phone": "0977888888"}, format="json")
        self.assertEqual(r.status_code, 202)
        self.assertNotIn("devCode", r.data)

    def test_reset_clears_a_lockout(self):
        register()
        c = APIClient()
        for _ in range(5):
            c.post("/api/v1/auth/login", {"phone": "0977000001", "pin": "0000"}, format="json")
        code = c.post("/api/v1/auth/pin-reset/request", {"phone": "0977000001"}, format="json").data["devCode"]
        c.post("/api/v1/auth/pin-reset/confirm", {"phone": "0977000001", "code": code, "new_pin": "7777"},
               format="json")
        login("0977000001", "7777")


class StaffTests(BaseTestCase):
    def create_staff(self, client, **over):
        body = {"id": "staff_1", "name": "Staff One", "phone": "0977000002", "pin": "5678", **over}
        return client.post("/api/v1/staff", body, format="json")

    def test_owner_registers_staff_and_staff_can_sign_in(self):
        owner, _ = register()
        r = self.create_staff(owner)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["role"], "staff")
        self.assertEqual(r.data["ownerId"], "owner_a")
        staff = login("0977000002", "5678")
        me = staff.get("/api/v1/auth/me").data
        self.assertEqual((me["role"], me["id"]), ("staff", "staff_1"))

    def test_creating_staff_is_replay_safe(self):
        owner, _ = register()
        self.assertEqual(self.create_staff(owner).status_code, 201)
        self.assertEqual(self.create_staff(owner).status_code, 200)
        self.assertEqual(User.objects.filter(role="staff").count(), 1)

    def test_duplicate_staff_phone_is_a_clear_error(self):
        owner, _ = register()
        self.create_staff(owner)
        r = self.create_staff(owner, id="staff_2")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "phone_taken")

    def test_staff_cannot_manage_staff(self):
        owner, _ = register()
        self.create_staff(owner)
        staff = login("0977000002", "5678")
        self.assertEqual(self.create_staff(staff, id="staff_9", phone="0977000009").status_code, 403)
        self.assertEqual(staff.get("/api/v1/staff").status_code, 403)

    def test_owner_resets_and_deactivates_staff(self):
        owner, _ = register()
        self.create_staff(owner)
        self.assertEqual(owner.post("/api/v1/staff/staff_1/reset-pin", {"new_pin": "8888"}, format="json").status_code, 200)
        login("0977000002", "8888")
        self.assertEqual(owner.post("/api/v1/staff/staff_1/deactivate", {}, format="json").status_code, 200)
        r = APIClient().post("/api/v1/auth/login", {"phone": "0977000002", "pin": "8888"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_deactivated_staff_token_stops_working(self):
        owner, _ = register()
        self.create_staff(owner)
        staff = login("0977000002", "5678")
        owner.post("/api/v1/staff/staff_1/deactivate", {}, format="json")
        self.assertEqual(staff.get("/api/v1/auth/me").status_code, 401)

    def test_one_owner_cannot_touch_anothers_staff(self):
        owner, _ = register()
        self.create_staff(owner)
        other, _ = register(phone="0977000003", client_id="owner_b", name="Owner B")
        self.assertEqual(other.post("/api/v1/staff/staff_1/reset-pin", {"new_pin": "1111"}, format="json").status_code, 404)
        self.assertEqual(other.get("/api/v1/staff").data, [])


class TokenTests(BaseTestCase):
    def test_authed_helper_rejects_garbage(self):
        self.assertEqual(authed("nope").get("/api/v1/auth/me").status_code, 401)
