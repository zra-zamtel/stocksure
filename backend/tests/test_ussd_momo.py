"""Mobile money over USSD: the network, then a request to the customer's
wallet. The sale is written only once the provider says the customer paid."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.collections.models import PaymentRequest
from apps.collections.providers import BaseCollectionProvider, ProviderError
from apps.sync.models import MobileMoneyTxn, Payment, Sale, SyncChange
from apps.ussd.models import UssdPaymentRequest
from apps.ussd.services import handle

from .helpers import USSD_PIN, client_for, give_ussd_pins, make_shop

STAFF = "0977000002"
OWNER = "0977000001"
CUSTOMER = "0961234567"  # MTN


class RefusingProvider(BaseCollectionProvider):
    def start(self, request):
        raise ProviderError("The wallet is not registered.")

    def check(self, request):
        raise AssertionError("never started")


def age_requests(seconds=10):
    PaymentRequest.objects.update(created_at=timezone.now() - timedelta(seconds=seconds))


def sale_steps(*more):
    return "*".join([USSD_PIN, "1", "150", "2", *more])


@override_settings(COLLECTIONS_SIMULATED_DELAY_SECONDS=5, COLLECTIONS_TIMEOUT_SECONDS=120)
class UssdMobileMoneyTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        give_ussd_pins(self.owner, self.assistant)

    def send_request(self, customer=CUSTOMER, session="ATUid_1"):
        return handle(STAFF, sale_steps("1", "1", customer, "1"), session)

    def test_mobile_money_asks_for_the_network(self):
        answer = handle(STAFF, sale_steps())
        self.assertIn("1. MTN", answer)
        self.assertIn("3. Zamtel", answer)
        self.assertIn("1. Send payment request", handle(STAFF, sale_steps("1")))

    def test_customer_already_paid_records_the_sale_with_the_network(self):
        answer = handle(STAFF, sale_steps("2", "2"))
        self.assertIn("recorded (Airtel mobile money)", answer)
        payment = Payment.objects.get()
        self.assertEqual((payment.method, payment.provider), ("mobile_money", "Airtel"))
        self.assertEqual(payment.sale.reconcile_status, Sale.Reconcile.UNRESOLVED)
        change = SyncChange.objects.get(entity="sale")
        self.assertEqual(change.payload["payments"][0]["provider"], "Airtel")

    def test_the_request_is_confirmed_before_it_is_sent(self):
        answer = handle(STAFF, sale_steps("1", "1", CUSTOMER))
        self.assertEqual(answer, "CON Ask 0961234567 to pay K150.00 on MTN?\n1. Send\n2. Cancel")
        self.assertEqual(handle(STAFF, sale_steps("1", "1", CUSTOMER, "2")), "END Cancelled. Nothing was recorded.")
        self.assertFalse(PaymentRequest.objects.exists())

    @override_settings(COLLECTIONS_CUSTOMER_FEE_PERCENT="2.5")
    def test_the_fee_is_shown_when_one_is_passed_on(self):
        self.assertIn("K153.85 (incl. K3.85 fee)", handle(STAFF, sale_steps("1", "1", CUSTOMER)))

    def test_sending_starts_a_request_and_no_sale_yet(self):
        answer = self.send_request()
        self.assertTrue(answer.startswith("END Request sent to 0961234567"), answer)
        self.assertIn("choose 4 to check", answer)
        request = PaymentRequest.objects.get()
        self.assertEqual(
            (request.provider, request.phone, request.amount_ngwee, request.status),
            ("MTN", "260961234567", 15000, "pending"),
        )
        self.assertEqual(UssdPaymentRequest.objects.get().requested_by, self.assistant)
        self.assertFalse(Sale.objects.exists())

    def test_a_gateway_retry_does_not_prompt_the_customer_twice(self):
        self.send_request(session="ATUid_same")
        self.send_request(session="ATUid_same")
        self.assertEqual(PaymentRequest.objects.count(), 1)
        self.send_request(session="ATUid_other")
        self.assertEqual(PaymentRequest.objects.count(), 2)

    def test_the_sale_is_written_once_the_customer_pays(self):
        self.send_request()
        age_requests()
        with self.captureOnCommitCallbacks(execute=True):
            handle(STAFF, USSD_PIN)  # any new session settles open requests

        sale = Sale.objects.get()
        payment = sale.payments.get()
        request = PaymentRequest.objects.get()
        self.assertEqual(request.status, "successful")
        self.assertEqual(sale.recorded_by, self.assistant)
        self.assertEqual((payment.method, payment.provider), ("mobile_money", "MTN"))
        self.assertEqual(payment.mobile_money_reference, request.provider_reference)
        # Filed as received, so the phone matches it on the reference at once.
        txn = MobileMoneyTxn.objects.get()
        self.assertEqual((txn.reference, txn.amount, txn.sender), (request.provider_reference, 15000, CUSTOMER))
        entities = set(SyncChange.objects.values_list("entity", flat=True))
        self.assertTrue({"sale", "mobile_money_txn"} <= entities)

        # Settling again never writes a second sale.
        handle(STAFF, USSD_PIN)
        self.assertEqual(Sale.objects.count(), 1)

    def test_checking_requests_shows_where_each_stands(self):
        self.send_request()
        self.assertIn("K150.00 0961234567: waiting", handle(STAFF, f"{USSD_PIN}*4"))
        age_requests()
        self.assertIn("K150.00 0961234567: paid, sale saved", handle(STAFF, f"{USSD_PIN}*4"))
        self.assertEqual(Sale.objects.count(), 1)

    def test_the_owner_sees_the_staff_requests(self):
        self.send_request()
        self.assertIn("6. Payment requests", handle(OWNER, USSD_PIN))
        self.assertIn("0961234567: waiting", handle(OWNER, f"{USSD_PIN}*6"))

    def test_a_declined_request_never_becomes_a_sale(self):
        self.send_request(customer="0961234000")
        age_requests()
        self.assertIn("0961234000: declined", handle(STAFF, f"{USSD_PIN}*4"))
        self.assertFalse(Sale.objects.exists())

    def test_a_number_on_another_network_is_refused(self):
        answer = handle(STAFF, sale_steps("1", "1", "0971234567"))
        self.assertEqual(answer, "END 0971234567 is on Airtel, not MTN. Please dial again.")

    def test_a_bad_number_is_refused(self):
        self.assertIn("not a valid phone number", handle(STAFF, sale_steps("1", "1", "12345")))

    def test_requests_are_capped_like_the_app(self):
        answer = handle(STAFF, f"{USSD_PIN}*1*60000*2*1*1")
        self.assertIn("limited to K50,000", answer)

    @override_settings(COLLECTIONS_PROVIDER="tests.test_ussd_momo.RefusingProvider")
    def test_a_provider_refusal_is_shown_and_nothing_is_recorded(self):
        answer = self.send_request()
        self.assertEqual(answer, "END Request not sent: The wallet is not registered.")
        self.assertFalse(Sale.objects.exists())
        self.assertIn("declined", handle(STAFF, f"{USSD_PIN}*4"))

    def test_the_phone_pull_settles_paid_requests(self):
        self.send_request()
        age_requests()
        response = client_for(self.owner).get("/api/v1/sync/pull?cursor=0")
        self.assertEqual(response.status_code, 200)
        entities = [change["entity"] for change in response.json()["changes"]]
        self.assertIn("sale", entities)
        self.assertIn("mobile_money_txn", entities)

    def test_cash_still_records_straight_away(self):
        self.assertEqual(handle(STAFF, f"{USSD_PIN}*1*80*1"), "END Sale of K80.00 recorded (Cash).")
        self.assertEqual(Payment.objects.get().method, "cash")
