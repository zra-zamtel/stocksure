import json
from datetime import date

from django.core.cache import cache
from django.test import TestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.sync.models import (
    MobileMoneyTxn,
    Payment,
    Product,
    ProductVariant,
    Reconciliation,
    Sale,
    SaleLine,
    Shop,
    StockMovement,
    TaxPeriod,
    TaxPotEntry,
)

NOW = "2026-11-18T08:00:00Z"
DAY = "2026-11-18"


def auth(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}


def shop_payload(**extra):
    return {
        "id": "shop_1",
        "name": "Test Shop",
        "type": "shoes",
        "town": "Kabwe",
        "currency": "ZMW",
        "language": "en",
        "usesBarcodes": False,
        "lowStockDefault": 3,
        "turnoverTaxRegistered": False,
        "tpin": "",
        "providersJson": [],
        "onboardingCompleted": True,
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def product_payload(**extra):
    return {
        "id": "prod_1",
        "name": "Sneaker",
        "category": "Shoes",
        "defaultBuyPrice": 30000,
        "defaultSellPrice": 45000,
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def variant_payload(**extra):
    return {
        "id": "var_1",
        "productId": "prod_1",
        "size": "41",
        "colour": "Black",
        "barcode": "",
        "buyPrice": 30000,
        "sellPrice": 45000,
        "lowStockLevel": 1,
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def movement_payload(**extra):
    return {
        "id": "mv_1",
        "variantId": "var_1",
        "quantityChange": 10,
        "reason": "opening",
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def sale_payload(**extra):
    sale = {
        "id": "sale_1",
        "recordedBy": "owner_1",
        "subtotal": 45000,
        "discountTotal": 0,
        "total": 45000,
        "status": "active",
        "reconcileStatus": "unresolved",
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    lines = [
        {
            "id": "line_1",
            "saleId": "sale_1",
            "variantId": "var_1",
            "quantity": 1,
            "buyPrice": 30000,
            "listPrice": 45000,
            "discount": 0,
            "finalPrice": 45000,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
    ]
    payments = [
        {
            "id": "pay_1",
            "saleId": "sale_1",
            "method": "cash",
            "amount": 45000,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
    ]
    movements = [
        {
            "id": "mv_sale_1",
            "variantId": "var_1",
            "quantityChange": -1,
            "reason": "sale",
            "saleId": "sale_1",
            "createdAt": NOW,
            "updatedAt": NOW,
        }
    ]
    data = {"sale": sale, "lines": lines, "payments": payments, "stockMovements": movements}
    data.update(extra)
    return data


class SyncBase(TestCase):
    """Helpers only, so other test modules can reuse them without re-running these tests."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user(
            "0971234567", "correct horse battery", full_name="Owner"
        )
        self.other = User.objects.create_user(
            "0977000002", "correct horse battery", full_name="Other"
        )

    def push(self, changes, user=None):
        return self.client.post(
            "/api/v1/sync/push",
            data=json.dumps({"deviceId": "dev_1", "batchId": "batch_1", "changes": changes}),
            content_type="application/json",
            **(auth(user or self.owner)),
        )

    def change(self, queue_id, entity, entity_id, payload, operation="create"):
        return {
            "queueId": queue_id,
            "entity": entity,
            "entityId": entity_id,
            "operation": operation,
            "payload": payload,
            "clientCreatedAt": NOW,
            "attempts": 0,
        }

    def push_schema(self):
        response = self.push(
            [
                self.change("q_shop", "shop", "shop_1", shop_payload()),
                self.change("q_product", "product", "prod_1", product_payload()),
                self.change("q_variant", "product_variant", "var_1", variant_payload()),
                self.change("q_movement", "stock_movement", "mv_1", movement_payload()),
            ]
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["rejected"], [])
        return response


class SyncTestCase(SyncBase):
    def test_push_shop_stores_text_id_and_ngwee(self):
        response = self.push([self.change("q_shop", "shop", "shop_1", shop_payload())])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["accepted"], ["q_shop"])
        shop = Shop.objects.get(id="shop_1")
        self.assertEqual(shop.owner, self.owner)
        self.assertEqual(shop.low_stock_default, 3)
        self.assertIsInstance(Shop._meta.get_field("id"), type(Shop._meta.pk))
        self.assertEqual(
            Product._meta.get_field("default_buy_price").get_internal_type(),
            "PositiveIntegerField",
        )

    def test_push_product_variant_and_append_stock(self):
        self.push_schema()

        variant = ProductVariant.objects.get(id="var_1")
        self.assertEqual(variant.product_id, "prod_1")
        self.assertEqual(variant.quantity, 10)
        self.assertEqual(StockMovement.objects.count(), 1)
        self.assertEqual(StockMovement.objects.get(id="mv_1").quantity_change, 10)

    def test_push_sale_with_lines_payments_and_movements(self):
        self.push_schema()
        response = self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["rejected"], [])
        sale = Sale.objects.get(id="sale_1")
        self.assertEqual(sale.total, 45000)
        self.assertEqual(sale.recorded_by, self.owner)
        self.assertEqual(SaleLine.objects.get(id="line_1").final_price, 45000)
        self.assertEqual(Payment.objects.get(id="pay_1").amount, 45000)
        self.assertEqual(ProductVariant.objects.get(id="var_1").quantity, 9)

    def test_replay_is_idempotent(self):
        self.push_schema()
        change = self.change("q_sale", "sale", "sale_1", sale_payload())
        self.push([change])
        self.push([change])

        self.assertEqual(Sale.objects.count(), 1)
        self.assertEqual(SaleLine.objects.count(), 1)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(StockMovement.objects.filter(sale_id="sale_1").count(), 1)
        self.assertEqual(ProductVariant.objects.get(id="var_1").quantity, 9)

    def test_update_void_adds_a_reversal_movement(self):
        self.push_schema()
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])

        response = self.push(
            [
                self.change(
                    "q_void",
                    "sale",
                    "sale_1",
                    {
                        "sale": {
                            "id": "sale_1",
                            "status": "void",
                            "voidReason": "wrong item",
                            "updatedAt": NOW,
                        },
                        "stockMovements": [
                            {
                                "id": "mv_void",
                                "variantId": "var_1",
                                "quantityChange": 1,
                                "reason": "void",
                                "saleId": "sale_1",
                                "createdAt": NOW,
                                "updatedAt": NOW,
                            }
                        ],
                    },
                    operation="update",
                )
            ]
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rejected"], [])
        sale = Sale.objects.get(id="sale_1")
        self.assertEqual(sale.status, "void")
        self.assertEqual(sale.void_reason, "wrong item")
        self.assertEqual(ProductVariant.objects.get(id="var_1").quantity, 10)

    def test_stock_movements_are_append_only(self):
        self.push_schema()

        response = self.push(
            [
                self.change(
                    "q_mv_update",
                    "stock_movement",
                    "mv_1",
                    movement_payload(quantityChange=99),
                    operation="update",
                )
            ]
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["rejected"]), 1)
        self.assertIn("append-only", response.json()["rejected"][0]["reason"])
        self.assertEqual(StockMovement.objects.get(id="mv_1").quantity_change, 10)

    def test_unknown_variant_is_rejected_not_repaired(self):
        self.push(
            [
                self.change("q_shop", "shop", "shop_1", shop_payload()),
                self.change("q_product", "product", "prod_1", product_payload()),
            ]
        )

        response = self.push(
            [
                self.change(
                    "q_bad",
                    "product_variant",
                    "var_404",
                    variant_payload(id="var_404", productId="prod_404"),
                )
            ]
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["accepted"], [])
        self.assertIn("productId does not exist", response.json()["rejected"][0]["reason"])
        self.assertFalse(ProductVariant.objects.filter(id="var_404").exists())

    def test_zero_stock_movement_is_rejected(self):
        self.push_schema()

        response = self.push(
            [self.change("q_zero", "stock_movement", "mv_zero", movement_payload(id="mv_zero", quantityChange=0))]
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["rejected"]), 1)
        self.assertFalse(StockMovement.objects.filter(id="mv_zero").exists())

    def test_reconciliation_tax_period_and_pot_entry(self):
        self.push_schema()
        tax = {
            "id": "tax_1",
            "startsOn": "2026-11-01",
            "endsOn": "2026-11-30",
            "turnover": 45000,
            "rateUsed": 0.05,
            "estimatedTax": 1800,
            "dueOn": "2026-12-10",
            "paid": False,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
        pot = {
            "id": "pot_1",
            "periodId": "tax_1",
            "amount": 500,
            "kind": "top_up",
            "createdAt": NOW,
            "updatedAt": NOW,
        }
        recon = {
            "id": "rec_1",
            "day": DAY,
            "matchedCount": 1,
            "saleNoPaymentCount": 0,
            "paymentNoSaleCount": 0,
            "openingFloat": 0,
            "countedCash": 45000,
            "expectedCash": 45000,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
        response = self.push(
            [
                self.change("q_tax", "tax_period", "tax_1", tax),
                self.change("q_pot", "tax_pot_entry", "pot_1", pot),
                self.change("q_rec", "reconciliation", "rec_1", recon),
            ]
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["rejected"], [])
        self.assertEqual(TaxPeriod.objects.get(id="tax_1").estimated_tax, 1800)
        self.assertEqual(TaxPotEntry.objects.get(id="pot_1").amount, 500)
        self.assertEqual(Reconciliation.objects.get(id="rec_1").counted_cash, 45000)
        self.assertEqual(Reconciliation.objects.get(id="rec_1").day, date(2026, 11, 18))

    def test_pull_returns_changes_after_the_cursor(self):
        self.push_schema()

        first = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.owner))
        self.assertEqual(first.status_code, 200)
        payload = first.json()
        self.assertEqual(len(payload["changes"]), 4)
        self.assertTrue(payload["nextCursor"])

        second = self.client.get(
            f"/api/v1/sync/pull?cursor={payload['nextCursor']}", **auth(self.owner)
        )
        self.assertEqual(second.json()["changes"], [])

    def test_pull_is_scoped_to_the_owner(self):
        self.push_schema()

        response = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.other))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["changes"], [])

    def test_ussd_uses_the_synced_shop_and_records_a_sale(self):
        from apps.ussd.services import handle

        self.push_schema()

        self.assertTrue(handle("0971234567", "").startswith("CON StockSure"))
        recorded = handle("0971234567", "1*150*1")
        self.assertTrue(recorded.startswith("END Sale of K150.00"), recorded)
        summary = handle("0971234567", "2")
        self.assertIn("K150.00", summary)
        self.assertEqual(Sale.objects.filter(shop_id="shop_1").count(), 1)

        pull = self.client.get("/api/v1/sync/pull?cursor=0", **auth(self.owner))
        self.assertIn("sale", [change["entity"] for change in pull.json()["changes"]])

    def test_ussd_tax_estimate_uses_synced_sales(self):
        from datetime import date

        from apps.tax.models import TaxRuleSet
        from apps.ussd.services import handle

        TaxRuleSet.objects.create(
            name="Test rules",
            version=1,
            rate_percent="5",
            annual_turnover_threshold="5000000",
            effective_from=date(2020, 1, 1),
        )
        self.push_schema()
        self.push([self.change("q_sale", "sale", "sale_1", sale_payload())])

        answer = handle("0971234567", "3")

        self.assertIn("Estimated tax this month: K22.50", answer)

    def test_push_requires_auth(self):
        response = self.client.post(
            "/api/v1/sync/push",
            data=json.dumps({"changes": []}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 401)

    def test_push_rejects_more_than_the_batch_limit(self):
        changes = [
            self.change(f"q_{index}", "shop", "shop_1", shop_payload())
            for index in range(501)
        ]

        response = self.push(changes)

        self.assertEqual(response.status_code, 400)
        self.assertIn("at most 500", response.json()["detail"])

    def test_sale_totals_must_match_the_lines(self):
        self.push_schema()
        payload = sale_payload()
        payload["sale"]["total"] = 1

        response = self.push([self.change("q_bad_total", "sale", "sale_1", payload)])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["rejected"]), 1)
        self.assertFalse(Sale.objects.filter(id="sale_1").exists())
