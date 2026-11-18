import uuid

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.utils import iso_now

T0 = "2026-11-17T09:00:00.000Z"
T1 = "2026-11-17T09:05:00.000Z"
T2 = "2026-11-17T09:10:00.000Z"


class BaseTestCase(TestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache; each test starts fresh


def register(phone="0977000001", pin="1234", name="Owner A", client_id="owner_a"):
    c = APIClient()
    r = c.post("/api/v1/auth/register", {"id": client_id, "name": name, "phone": phone, "pin": pin}, format="json")
    assert r.status_code == 201, r.content
    return authed(r.data["access"]), r.data


def authed(token):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def login(phone, pin):
    r = APIClient().post("/api/v1/auth/login", {"phone": phone, "pin": pin}, format="json")
    assert r.status_code == 200, r.content
    return authed(r.data["access"])


def row(entity_id, ts=T0, **cols):
    return {"id": entity_id, "created_at": ts, "updated_at": ts, **cols}


def change(entity, payload, qid=None, operation="create"):
    return {
        "queueId": qid or f"q_{uuid.uuid4().hex[:8]}", "entity": entity, "entityId": payload["id"],
        "operation": operation, "payload": payload, "clientCreatedAt": payload.get("created_at", T0), "attempts": 0,
    }


def push(client, changes, device="dev_a", batch="batch_1"):
    return client.post(
        "/api/v1/sync/push", {"deviceId": device, "batchId": batch, "changes": changes}, format="json"
    )


def pull(client, cursor="0", **params):
    q = "&".join([f"cursor={cursor}"] + [f"{k}={v}" for k, v in params.items()])
    return client.get(f"/api/v1/sync/pull?{q}")


# ---- row builders (columns exactly as in docs/sync-contract.md) --------------------------------
def owner_row(id="owner_a", phone="260977000001", ts=T0):
    return row(id, ts, name="Owner A", phone=phone, pin_hash="hash-of-1234")


def staff_row(id="staff_1", phone="260977000002", ts=T0):
    return row(id, ts, name="Staff One", phone=phone, pin_hash="hash-of-5678", role="staff")


def shop_row(id="shop_1", ts=T0):
    return row(id, ts, name="Chiwala Fashions", type="clothes", town="Lusaka", currency="ZMW", language="en",
               uses_barcodes=1, low_stock_default=3, turnover_tax_registered=1, tpin=None,
               providers_json='["MTN","Airtel","Zamtel"]')


def product_row(id="prod_1", name="Black school shoes", ts=T0):
    return row(id, ts, name=name, category="Shoes", photo_uri=None, default_buy_price=15000,
               default_sell_price=25000, discount_json=None)


def variant_row(id="var_1", product_id="prod_1", barcode="6001234567890", ts=T0):
    return row(id, ts, product_id=product_id, size="42", colour="Black", barcode=barcode,
               buy_price=15000, sell_price=25000, low_stock_level=3)


def movement_row(id="mov_1", variant_id="var_1", qty=5, reason="opening", sale_id=None, ts=T0):
    return row(id, ts, variant_id=variant_id, quantity_change=qty, reason=reason, note=None, sale_id=sale_id)


def sale_row(id="sale_1", recorded_by="owner_a", total=25000, status="active", ts=T0, **extra):
    return row(id, ts, recorded_by=recorded_by, subtotal=total, discount_total=0, total=total, status=status,
               void_reason=extra.pop("void_reason", None), reconcile_status="unresolved", **extra)


def line_row(id="line_1", sale_id="sale_1", variant_id="var_1", ts=T0):
    return row(id, ts, sale_id=sale_id, variant_id=variant_id, quantity=1, buy_price=15000, list_price=25000,
               discount=0, final_price=25000)


def payment_row(id="pay_1", sale_id="sale_1", ts=T0):
    return row(id, ts, sale_id=sale_id, method="cash", provider=None, amount=25000, mobile_money_reference=None)


def base_data(client):
    """Owner, shop, one product with one variant and 5 pairs in stock."""
    r = push(client, [
        change("owner", owner_row()), change("shop", shop_row()), change("product", product_row()),
        change("product_variant", variant_row()), change("stock_movement", movement_row()),
    ])
    assert r.status_code == 200 and not r.data["rejected"], r.content
    return r


def now_stamp():
    return iso_now()
