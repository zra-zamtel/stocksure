import json

from django.test import TestCase

from apps.smartinvoice.models import SmartInvoiceLink, SmartInvoiceReceipt
from apps.sync.models import Sale, SyncChange

from .test_sync import NOW, SyncBase, auth, sale_payload

TPIN = "1002003004"


class SmartInvoiceTests(SyncBase, TestCase):
    def setUp(self):
        super().setUp()
        self.push_schema()

    def push(self, changes, user=None):
        # Sales are sent after the sync transaction commits, as in production.
        with self.captureOnCommitCallbacks(execute=True):
            return super().push(changes, user=user)

    def connect(self, tpin=TPIN, user=None):
        return self.client.post(
            "/api/v1/smart-invoice/connect",
            data=json.dumps({"shopId": "shop_1", "tpin": tpin}),
            content_type="application/json",
            **auth(user or self.owner),
        )

    def sell(self, sale_id="sale_1"):
        payload = sale_payload()
        response = self.push([self.change(f"q_{sale_id}", "sale", sale_id, payload)])
        self.assertEqual(response.json()["rejected"], [])

    def test_connecting_registers_the_device_and_sends_earlier_sales(self):
        self.sell()

        response = self.connect(tpin="100-200-3004")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["connected"])
        self.assertTrue(body["simulated"])
        self.assertEqual(body["tpin"], TPIN)
        self.assertEqual(body["sentCount"], 1)
        self.assertEqual(body["waitingCount"], 0)
        receipt = SmartInvoiceReceipt.objects.get()
        self.assertEqual(receipt.result_code, "000")
        self.assertTrue(receipt.receipt_signature)

    def test_a_tpin_needs_ten_digits(self):
        response = self.connect(tpin="12345")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SmartInvoiceLink.objects.exists())

    def test_only_the_owner_can_connect(self):
        response = self.connect(user=self.staff)
        self.assertIn(response.status_code, (403, 404))

    def test_a_new_sale_is_sent_as_a_turnover_tax_invoice(self):
        self.connect()
        self.sell()

        receipt = SmartInvoiceReceipt.objects.get(sale_id="sale_1")
        request = receipt.request
        self.assertEqual(request["tpin"], TPIN)
        self.assertEqual(request["rcptTyCd"], "S")
        self.assertEqual(request["salesTyCd"], "N")
        self.assertEqual(request["invcNo"], 1)
        self.assertEqual(request["totAmt"], Sale.objects.get(id="sale_1").total / 100)
        self.assertEqual(request["totTaxAmt"], 0)
        item = request["itemList"][0]
        self.assertEqual(item["taxTyCd"], "TOT")
        self.assertRegex(item["itemCd"], r"^ZM2NTU\d{7}$")
        self.assertEqual(request["regrNm"], "Given")

    def test_the_phone_pulls_the_receipt(self):
        self.connect()
        self.sell()

        for user in (self.owner, self.staff):
            changes = self.client.get("/api/v1/sync/pull?cursor=0", **auth(user)).json()["changes"]
            receipts = [c for c in changes if c["entity"] == "smart_invoice_receipt"]
            self.assertEqual(len(receipts), 1)
            self.assertEqual(receipts[0]["payload"]["saleId"], "sale_1")
            self.assertEqual(receipts[0]["payload"]["resultCode"], "000")

    def test_a_void_sends_a_refund_that_points_at_the_original(self):
        self.connect()
        self.sell()
        self.push(
            [
                self.change(
                    "q_void",
                    "sale",
                    "sale_1",
                    {"sale": {"id": "sale_1", "status": "void", "voidReason": "Wrong size", "updatedAt": NOW}},
                    operation="update",
                )
            ]
        )

        refund = SmartInvoiceReceipt.objects.get(sale_id="sale_1", receipt_type="R")
        self.assertEqual(refund.request["rcptTyCd"], "R")
        self.assertEqual(refund.request["orgInvcNo"], 1)
        self.assertEqual(refund.request["rfdRsnCd"], "13")
        self.assertEqual(refund.invoice_no, 2)

    def test_replaying_a_sale_does_not_send_it_twice(self):
        self.connect()
        self.sell()
        self.sell()

        self.assertEqual(SmartInvoiceReceipt.objects.count(), 1)
        self.assertEqual(SyncChange.objects.filter(entity="smart_invoice_receipt").count(), 1)

    def test_nothing_is_sent_before_the_shop_connects(self):
        self.sell()
        self.assertFalse(SmartInvoiceReceipt.objects.exists())

    def test_the_owner_can_see_what_was_sent(self):
        self.connect()
        self.sell()

        response = self.client.get("/api/v1/smart-invoice/sales/sale_1", **auth(self.owner))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["receipts"][0]["request"]["itemList"][0]["taxTyCd"], "TOT")

    def test_a_ussd_sale_is_sent_as_one_general_line(self):
        from apps.ussd.services import handle

        self.connect()
        with self.captureOnCommitCallbacks(execute=True):
            handle("0965551122", "4821*1*150*2*1*2")

        receipt = SmartInvoiceReceipt.objects.get()
        self.assertEqual(receipt.request["pmtTyCd"], "06")
        self.assertEqual(receipt.request["itemList"][0]["itemNm"], "Goods sold (amount only)")
