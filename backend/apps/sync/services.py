import logging
from datetime import date, datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.accounts.models import User
from apps.shops.models import Membership
from apps.shops.selling import OWNER_SALE_REFUSED, owner_may_record_sale

from .models import (
    MobileMoneyTxn,
    Payment,
    Product,
    ProductVariant,
    Reconciliation,
    Sale,
    SaleLine,
    Shop,
    StockMovement,
    SyncChange,
    TaxPeriod,
    TaxPotEntry,
)

logger = logging.getLogger(__name__)


class SyncError(Exception):
    """A row the server refuses to store. The message goes back to the phone."""


def _get(payload, *keys, default=None):
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return default


def _text(payload, *keys, required=False, default="", max_length=None):
    value = _get(payload, *keys, default=default)
    if value is None:
        value = default
    if not isinstance(value, str):
        raise SyncError(f"{keys[0]} must be text.")
    value = value.strip()
    if required and not value:
        raise SyncError(f"{keys[0]} is required.")
    if max_length and len(value) > max_length:
        raise SyncError(f"{keys[0]} is too long.")
    return value


def _int(payload, *keys, required=False, default=0, minimum=None):
    value = _get(payload, *keys, default=default)
    if value is None:
        value = default
    if isinstance(value, bool):
        raise SyncError(f"{keys[0]} must be a whole number.")
    if isinstance(value, float):
        if not value.is_integer():
            raise SyncError(f"{keys[0]} must be a whole number of ngwee.")
        value = int(value)
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise SyncError(f"{keys[0]} must be a whole number.")
    if minimum is not None and value < minimum:
        raise SyncError(f"{keys[0]} must be at least {minimum}.")
    return value


def _bool(payload, *keys, default=False):
    value = _get(payload, *keys, default=default)
    if isinstance(value, bool):
        return value
    if value in (0, 1, "0", "1"):
        return bool(int(value))
    raise SyncError(f"{keys[0]} must be true or false.")


def _choice(payload, *keys, choices, required=True, default=None):
    value = _text(payload, *keys, required=required, default=default or "")
    if not value and not required:
        return ""
    allowed = {str(choice) for choice in choices}
    if value not in allowed:
        raise SyncError(f"{keys[0]} must be one of: {', '.join(sorted(allowed))}.")
    return value


def _timestamp(payload, *keys, default=None):
    value = _get(payload, *keys)
    if value in (None, ""):
        return default or timezone.now()
    parsed = value if isinstance(value, datetime) else parse_datetime(str(value))
    if parsed is None:
        raise SyncError(f"{keys[0]} must be an ISO 8601 timestamp.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _date(payload, *keys, required=True, default=None):
    value = _get(payload, *keys, default=default)
    if isinstance(value, date):
        return value
    try:
        parsed = parse_date(str(value or ""))
    except ValueError:  # well-formed but impossible, e.g. 2027-02-30
        parsed = None
    if parsed is None:
        if required:
            raise SyncError(f"{keys[0]} must be YYYY-MM-DD.")
        return None
    return parsed


def _record(payload, *, default_id=None):
    created = _timestamp(payload, "createdAt", "created_at")
    return {
        "id": _text(payload, "id", required=True, default=default_id or "", max_length=64),
        "created_at": created,
        "updated_at": _timestamp(payload, "updatedAt", "updated_at", default=created),
    }


def _require_shop(shop: Shop | None) -> Shop:
    if shop is None:
        raise SyncError("Sync the shop before sending rows that belong to it.")
    return shop


def user_shops(user: User):
    """Sync shops the user can use: their own, plus the shop of an owner who
    added them as an assistant (the assistant link still lives on Membership)."""
    Shop.objects.filter(owner=user)
    memberships = (
        Membership.objects.select_related("shop__owner")
        .filter(user=user, is_active=True, shop__is_active=True)
        .exclude(shop__owner=user)
    )
    staff_owner_ids = {membership.shop.owner_id for membership in memberships}
    return Shop.objects.filter(Q(owner=user) | Q(owner_id__in=staff_owner_ids))


def resolve_shop(user: User, shop_id: str | None = None) -> Shop | None:
    qs = user_shops(user)
    if shop_id:
        return qs.filter(id=shop_id).first()
    return qs.first()


def is_owner(user: User, shop: Shop) -> bool:
    return shop.owner_id == user.id


# ---- staff rules -------------------------------------------------------------
#
# The same matrix as mobile/src/core/permissions.ts. A staff member records
# sales and counts cash; everything else is the owner's. The phone's automatic
# matcher also runs on a staff phone, so its outputs (a stored match pair, a
# sale's reconcile status, a message's matched/unmatched status) are allowed,
# but a human decision (money arrived, not a sale, void) is not.

OWNER_ONLY = "Only the shop owner can make this change."
STAFF_HIDDEN_ENTITIES = {"tax_period", "tax_pot_entry", "reconciliation"}
_META = {"id", "createdAt", "created_at", "updatedAt", "updated_at", "shopId", "shop_id"}


def _only_keys(data: dict, allowed: set[str]) -> None:
    if set(data) - allowed - _META:
        raise SyncError(OWNER_ONLY)


def check_staff_change(entity: str, operation: str, payload: dict, entity_id: str, shop: Shop) -> None:
    """Raise SyncError unless a staff member may push this change."""
    if entity == "sale":
        data = _sale_body(payload, entity_id)
        if operation == "create" and not Sale.objects.filter(id=entity_id).exists():
            if _get(data, "status", default="active") != "active":
                raise SyncError(OWNER_ONLY)
            for payment in payload.get("payments") or []:
                if isinstance(payment, dict) and any(
                    _get(payment, key) for key in ("confirmedAt", "confirmed_at", "matchedTxnId", "matched_txn_id")
                ):
                    raise SyncError(OWNER_ONLY)
            for movement in payload.get("stockMovements") or payload.get("stock_movements") or []:
                if isinstance(movement, dict) and movement.get("reason") != StockMovement.Reason.SALE:
                    raise SyncError(OWNER_ONLY)
            return
        # An existing sale: only the matcher's reconcile status may change.
        if any(payload.get(key) for key in ("lines", "payments", "stockMovements", "stock_movements")):
            raise SyncError(OWNER_ONLY)
        _only_keys(data, {"reconcileStatus", "reconcile_status"})
        return

    if entity == "stock_movement":
        if operation != "create" or payload.get("reason") != StockMovement.Reason.SALE:
            raise SyncError(OWNER_ONLY)
        return

    if entity == "payment":
        if operation != "update":
            raise SyncError(OWNER_ONLY)
        _only_keys(payload, {"matchedTxnId", "matched_txn_id"})
        return

    if entity == "mobile_money_txn":
        if _get(payload, "status") == MobileMoneyTxn.Status.IGNORED:
            raise SyncError(OWNER_ONLY)
        if operation == "update":
            _only_keys(payload, {"status"})
        return

    if entity == "reconciliation":
        # A blind cash count: staff may record it once, never replace it.
        row = Reconciliation.objects.filter(id=_get(payload, "id", default=entity_id), shop=shop).first()
        if row is not None and row.counted_cash is not None:
            raise SyncError("A cash count is already saved for this day. Ask the owner to change it.")
        _only_keys(payload, {"day", "countedCash", "counted_cash", "note", "openingFloat", "opening_float"})
        return

    raise SyncError(OWNER_ONLY)


def staff_payload(entity: str, payload: dict) -> dict | None:
    """What a staff phone may receive. None means the row is not sent at all."""
    if entity in STAFF_HIDDEN_ENTITIES:
        return None
    hidden = {
        "product": {"defaultBuyPrice", "default_buy_price"},
        "product_variant": {"buyPrice", "buy_price"},
    }.get(entity)
    if hidden:
        return {key: value for key, value in payload.items() if key not in hidden}
    if entity == "sale" and isinstance(payload.get("lines"), list):
        lines = [
            {key: value for key, value in line.items() if key not in ("buyPrice", "buy_price")}
            if isinstance(line, dict)
            else line
            for line in payload["lines"]
        ]
        return {**payload, "lines": lines}
    return payload


# ---- per-entity upserts ---------------------------------------------------


def upsert_shop(payload, user: User) -> Shop:
    ids = _record(payload)
    shop = Shop.objects.filter(id=ids["id"]).first()
    if shop and shop.owner_id != user.id:
        raise SyncError("That shop belongs to another account.")
    if shop is None:
        # Registration creates a placeholder so staff and USSD have a shop
        # before the phone syncs. The phone's first real shop adopts it: rows
        # USSD already wrote there (sales, TaxPot top-ups) move to the phone's
        # shop instead of being lost. A second real shop is refused.
        existing = Shop.objects.filter(owner=user).exclude(id=ids["id"]).first()
        if existing is not None and existing.products.exists():
            raise SyncError("This account already has a synced shop.")
        shop = Shop(id=ids["id"], owner=user, created_at=ids["created_at"])
        _fill_shop(shop, payload, ids)
        shop.save()
        if existing is not None:
            adopt_placeholder(existing, shop)
        return shop
    # An existing shop takes partial updates: the phone sends only what changed
    # (the money step sends providers and tax status, finishing setup sends the
    # completed flag), and everything else stays as it was.
    _fill_shop(shop, payload, ids, partial=True)
    shop.save()
    return shop


def _fill_shop(shop: Shop, payload: dict, ids: dict, *, partial: bool = False) -> None:
    def sent(*keys) -> bool:
        return not partial or any(key in payload for key in keys)

    if sent("name"):
        shop.name = _text(payload, "name", required=True, max_length=150)
    if sent("type"):
        shop.type = _text(payload, "type", default="other", max_length=20)
    profile_id = _text(payload, "profileId", "profile_id", default="", max_length=30)
    if profile_id:
        shop.profile_id = profile_id
    elif not partial:
        # An older phone sends no profile: derive it from the legacy type, as the phone does.
        shop.profile_id = "fashion" if shop.type in ("clothes", "shoes") else "general"
    if sent("town"):
        shop.town = _text(payload, "town", default="", max_length=80)
    if sent("currency"):
        shop.currency = _text(payload, "currency", default="ZMW", max_length=3)
    if sent("language"):
        shop.language = _text(payload, "language", default="en", max_length=2)
    if sent("usesBarcodes", "uses_barcodes"):
        shop.uses_barcodes = _bool(payload, "usesBarcodes", "uses_barcodes", default=False)
    if sent("lowStockDefault", "low_stock_default"):
        shop.low_stock_default = _int(
            payload, "lowStockDefault", "low_stock_default", default=3, minimum=0
        )
    if sent("turnoverTaxRegistered", "turnover_tax_registered"):
        shop.turnover_tax_registered = _bool(
            payload, "turnoverTaxRegistered", "turnover_tax_registered", default=False
        )
    if sent("tpin"):
        shop.tpin = _text(payload, "tpin", default="", max_length=20)
    # The phone calls it ``providers``; the others are older spellings.
    if sent("providersJson", "providers_json", "providers"):
        providers = _get(payload, "providersJson", "providers_json", "providers", default=[])
        if not isinstance(providers, list | dict):
            raise SyncError("providersJson must be a JSON list or object.")
        shop.providers_json = providers
    if sent("onboardingCompleted", "onboarding_completed"):
        shop.onboarding_completed = _bool(
            payload, "onboardingCompleted", "onboarding_completed", default=False
        )
    shop.updated_at = ids["updated_at"]


def period_id_for(shop: Shop, starts_on) -> str:
    """One tax period per shop and month, with the same id on phone and server,
    so a USSD TaxPot top-up and the phone's period are the same row."""
    return f"tax_{shop.id}_{str(starts_on)[:7]}"


def adopt_placeholder(placeholder: Shop, shop: Shop) -> None:
    """Move everything written to the registration placeholder onto the phone's
    shop, re-key tax periods to the phone's id scheme, and re-point the pull log,
    then remove the empty placeholder."""
    for model in (Product, ProductVariant, StockMovement, Sale, Payment, MobileMoneyTxn, Reconciliation):
        model.objects.filter(shop=placeholder).update(shop=shop)

    for period in list(TaxPeriod.objects.filter(shop=placeholder)):
        new_id = period_id_for(shop, period.starts_on)
        target = TaxPeriod.objects.filter(id=new_id).first()
        if target is None:
            target = TaxPeriod.objects.create(
                id=new_id,
                shop=shop,
                starts_on=period.starts_on,
                ends_on=period.ends_on,
                turnover=period.turnover,
                rate_used=period.rate_used,
                estimated_tax=period.estimated_tax,
                due_on=period.due_on,
                paid=period.paid,
                created_at=period.created_at,
                updated_at=period.updated_at,
            )
        TaxPotEntry.objects.filter(period=period).update(period=target, shop=shop)
        for change in SyncChange.objects.filter(shop=placeholder, entity="tax_pot_entry"):
            if change.payload.get("periodId") == period.id:
                change.payload = {**change.payload, "periodId": new_id}
                change.save(update_fields=["payload"])
        SyncChange.objects.filter(shop=placeholder, entity="tax_period", entity_id=period.id).delete()
        SyncChange.objects.create(
            shop=placeholder,
            entity="tax_period",
            entity_id=new_id,
            operation="create",
            payload=tax_period_payload(target),
        )
        period.delete()

    TaxPotEntry.objects.filter(shop=placeholder).update(shop=shop)
    SyncChange.objects.filter(shop=placeholder).update(shop=shop)
    placeholder.delete()


def tax_period_payload(period: TaxPeriod) -> dict:
    return {
        "id": period.id,
        "startsOn": str(period.starts_on),
        "endsOn": str(period.ends_on),
        "turnover": period.turnover,
        "rateUsed": float(period.rate_used),
        "estimatedTax": period.estimated_tax,
        "dueOn": str(period.due_on),
        "paid": period.paid,
        "createdAt": period.created_at.isoformat(),
        "updatedAt": period.updated_at.isoformat(),
    }


def upsert_product(payload, shop: Shop, *, partial: bool = False) -> Product:
    ids = _record(payload)
    product = Product.objects.filter(id=ids["id"]).first()
    if product and product.shop_id != shop.id:
        raise SyncError("That product belongs to another shop.")
    if product is None:
        product = Product(id=ids["id"], shop=shop, created_at=ids["created_at"])
        partial = False
    # An update carries only what changed on the phone; everything else stays.

    def sent(*keys) -> bool:
        return not partial or any(key in payload for key in keys)

    if sent("name"):
        product.name = _text(payload, "name", required=True, max_length=150)
    if sent("category"):
        product.category = _text(payload, "category", default="", max_length=80)
    if sent("photoUri", "photo_uri"):
        product.photo_uri = _text(payload, "photoUri", "photo_uri", default="", max_length=255)
    if sent("defaultBuyPrice", "default_buy_price"):
        product.default_buy_price = _int(
            payload, "defaultBuyPrice", "default_buy_price", default=0, minimum=0
        )
    if sent("defaultSellPrice", "default_sell_price"):
        product.default_sell_price = _int(
            payload, "defaultSellPrice", "default_sell_price", default=0, minimum=0
        )
    if sent("discountJson", "discount_json"):
        discount = _get(payload, "discountJson", "discount_json")
        if discount is not None and not isinstance(discount, dict | list):
            raise SyncError("discountJson must be a JSON object or list.")
        product.discount_json = discount
    if sent("unit"):
        product.unit = _text(payload, "unit", default="", max_length=20)
    if sent("saleWarning", "sale_warning"):
        product.sale_warning = _text(payload, "saleWarning", "sale_warning", default="", max_length=60)
    product.updated_at = ids["updated_at"]
    product.save()
    return product


def upsert_variant(payload, shop: Shop, *, partial: bool = False) -> ProductVariant:
    ids = _record(payload)
    variant = ProductVariant.objects.filter(id=ids["id"]).first()
    if variant and variant.shop_id != shop.id:
        raise SyncError("That variant belongs to another shop.")
    if variant is None:
        partial = False
    # An update carries only what changed on the phone (a restock sends the new
    # buy price or expiry, "generate barcode" sends the barcode); the rest stays.

    def sent(*keys) -> bool:
        return not partial or any(key in payload for key in keys)

    if sent("productId", "product_id"):
        product_id = _text(payload, "productId", "product_id", required=True, max_length=64)
        product = Product.objects.filter(id=product_id, shop=shop).first()
        if product is None:
            raise SyncError("productId does not exist in this shop.")
        if variant is None:
            variant = ProductVariant(
                id=ids["id"], shop=shop, product=product, created_at=ids["created_at"]
            )
        variant.product = product
    if sent("size"):
        variant.size = _text(payload, "size", default="", max_length=20)
    if sent("colour", "color"):
        variant.colour = _text(payload, "colour", "color", default="", max_length=40)
    if sent("barcode"):
        variant.barcode = _text(payload, "barcode", default="", max_length=64)
    if sent("buyPrice", "buy_price"):
        variant.buy_price = _int(payload, "buyPrice", "buy_price", default=0, minimum=0)
    if sent("sellPrice", "sell_price"):
        variant.sell_price = _int(payload, "sellPrice", "sell_price", default=0, minimum=0)
    if sent("lowStockLevel", "low_stock_level"):
        variant.low_stock_level = _int(
            payload, "lowStockLevel", "low_stock_level", default=3, minimum=0
        )
    if sent("expiryDate", "expiry_date"):
        variant.expiry_date = _date(payload, "expiryDate", "expiry_date", required=False)
        if variant.expiry_date is None and _get(payload, "expiryDate", "expiry_date") not in (None, ""):
            raise SyncError("expiryDate must be YYYY-MM-DD.")
    if sent("batchNo", "batch_no"):
        variant.batch_no = _text(payload, "batchNo", "batch_no", default="", max_length=60)
    variant.updated_at = ids["updated_at"]
    variant.save()
    return variant


def insert_movement(payload, shop: Shop, *, existing_is_ok=True) -> StockMovement:
    ids = _record(payload)
    existing = StockMovement.objects.filter(id=ids["id"]).first()
    if existing is not None:
        if existing.shop_id != shop.id:
            raise SyncError("That stock movement belongs to another shop.")
        if existing_is_ok:
            return existing
        raise SyncError("Stock movements are append-only; that id already exists.")
    variant_id = _text(payload, "variantId", "variant_id", required=True, max_length=64)
    variant = ProductVariant.objects.filter(id=variant_id, shop=shop).first()
    if variant is None:
        raise SyncError("variantId does not exist in this shop.")
    quantity = _int(payload, "quantityChange", "quantity_change", required=True)
    if quantity == 0:
        raise SyncError("quantityChange cannot be zero.")
    reason = _choice(
        payload,
        "reason",
        choices=StockMovement.Reason.values,
        required=True,
    )
    sale_id = _text(payload, "saleId", "sale_id", default="", max_length=64)
    if sale_id and not Sale.objects.filter(id=sale_id, shop=shop).exists():
        raise SyncError("saleId does not exist in this shop.")
    return StockMovement.objects.create(
        id=ids["id"],
        shop=shop,
        variant=variant,
        quantity_change=quantity,
        reason=reason,
        note=_text(payload, "note", default="", max_length=255),
        sale_id=sale_id,
        created_at=ids["created_at"],
        updated_at=ids["updated_at"],
    )


def _sale_body(payload: dict, entity_id: str) -> dict:
    sale = payload.get("sale") if isinstance(payload.get("sale"), dict) else payload
    nested_id = sale.get("id")
    if nested_id and str(nested_id) != str(entity_id):
        raise SyncError("sale.id does not match the change's entityId.")
    return sale


def _upsert_sale_fields(sale: Sale, data: dict) -> Sale:
    if "subtotal" in data:
        sale.subtotal = _int(data, "subtotal", minimum=0)
    if "discountTotal" in data or "discount_total" in data:
        sale.discount_total = _int(data, "discountTotal", "discount_total", minimum=0)
    if "total" in data:
        sale.total = _int(data, "total", minimum=0)
    if "status" in data:
        sale.status = _choice(data, "status", choices=Sale.Status.values)
    if "voidReason" in data or "void_reason" in data:
        sale.void_reason = _text(data, "voidReason", "void_reason", default="", max_length=255)
    if "reconcileStatus" in data or "reconcile_status" in data:
        sale.reconcile_status = _choice(
            data, "reconcileStatus", "reconcile_status", choices=Sale.Reconcile.values
        )
    return sale


def _check_sale_totals(sale: Sale) -> None:
    stored = list(sale.lines.all())
    if not stored:
        raise SyncError("A sale needs at least one line.")
    if sum(line.list_price for line in stored) != sale.subtotal:
        raise SyncError("subtotal does not match the sum of line list prices.")
    if sum(line.discount for line in stored) != sale.discount_total:
        raise SyncError("discountTotal does not match the sum of line discounts.")
    if sum(line.final_price for line in stored) != sale.total:
        raise SyncError("total does not match the sum of line final prices.")


def upsert_sale(payload: dict, shop: Shop, entity_id: str, user: User, *, owner: bool = True) -> Sale:
    data = _sale_body(payload, entity_id)
    ids = _record(data, default_id=entity_id)
    sale = Sale.objects.filter(id=ids["id"]).first()
    if sale and sale.shop_id != shop.id:
        raise SyncError("That sale belongs to another shop.")
    created = sale is None
    if created:
        sale = Sale(
            id=ids["id"],
            shop=shop,
            recorded_by=user,
            created_at=ids["created_at"],
            subtotal=0,
            discount_total=0,
            total=0,
        )
    _upsert_sale_fields(sale, data)
    sale.updated_at = ids["updated_at"]
    sale.save()

    lines = payload.get("lines") or []
    if not isinstance(lines, list):
        raise SyncError("lines must be a list.")
    for line in lines:
        if not isinstance(line, dict):
            raise SyncError("Each line must be an object.")
        line_ids = _record(line)
        variant_id = _text(line, "variantId", "variant_id", required=True, max_length=64)
        variant = ProductVariant.objects.filter(id=variant_id, shop=shop).first()
        if variant is None:
            raise SyncError(f"variant {variant_id} does not exist in this shop.")
        quantity = _int(line, "quantity", required=True, minimum=1)
        # A staff phone never receives buy prices, so the cost snapshot for its
        # sale comes from the server's variant instead of the phone.
        buy_price = (
            _int(line, "buyPrice", "buy_price", default=0, minimum=0) if owner else variant.buy_price
        )
        list_price = _int(line, "listPrice", "list_price", default=0, minimum=0)
        discount = _int(line, "discount", default=0, minimum=0)
        final_price = _int(line, "finalPrice", "final_price", default=0, minimum=0)
        existing_line = SaleLine.objects.filter(id=line_ids["id"]).first()
        if existing_line and existing_line.sale_id != sale.id:
            raise SyncError("That sale line belongs to another sale.")
        SaleLine.objects.update_or_create(
            id=line_ids["id"],
            defaults={
                "sale": sale,
                "variant": variant,
                "quantity": quantity,
                "buy_price": buy_price,
                "list_price": list_price,
                "discount": discount,
                "final_price": final_price,
                "created_at": line_ids["created_at"],
                "updated_at": line_ids["updated_at"],
            },
        )

    # Any change that could move money is checked against the lines, on create
    # and on update alike. A status-only update leaves both sides untouched.
    touches_money = created or lines or any(
        key in data for key in ("subtotal", "discountTotal", "discount_total", "total")
    )
    if touches_money:
        _check_sale_totals(sale)

    payments = payload.get("payments") or []
    if not isinstance(payments, list):
        raise SyncError("payments must be a list.")
    for payment in payments:
        if not isinstance(payment, dict):
            raise SyncError("Each payment must be an object.")
        if _text(payment, "saleId", "sale_id", default=entity_id, max_length=64) not in (
            entity_id,
            sale.id,
        ):
            raise SyncError("payment.saleId does not match the sale.")
        upsert_payment({**payment, "saleId": sale.id}, shop, partial=not created)

    movements = payload.get("stockMovements") or payload.get("stock_movements") or []
    if not isinstance(movements, list):
        raise SyncError("stockMovements must be a list.")
    for movement in movements:
        if not isinstance(movement, dict):
            raise SyncError("Each stock movement must be an object.")
        insert_movement({**movement, "saleId": sale.id}, shop)

    sale.refresh_from_db()
    return sale


def upsert_payment(payload: dict, shop: Shop, *, partial=False) -> Payment:
    ids = _record(payload)
    payment = Payment.objects.filter(id=ids["id"]).first()
    if payment and payment.shop_id != shop.id:
        raise SyncError("That payment belongs to another shop.")
    if payment is None:
        sale_id = _text(payload, "saleId", "sale_id", required=True, max_length=64)
        sale = Sale.objects.filter(id=sale_id, shop=shop).first()
        if sale is None:
            raise SyncError("saleId does not exist in this shop.")
        payment = Payment(
            id=ids["id"],
            shop=shop,
            sale=sale,
            created_at=ids["created_at"],
            method=_choice(payload, "method", choices=Payment.Method.values),
            amount=_int(payload, "amount", required=True, minimum=1),
        )
    elif "saleId" in payload or "sale_id" in payload:
        sale_id = _text(payload, "saleId", "sale_id", max_length=64)
        sale = Sale.objects.filter(id=sale_id, shop=shop).first()
        if sale is None:
            raise SyncError("saleId does not exist in this shop.")
        payment.sale = sale
    if not partial or "method" in payload:
        payment.method = _choice(payload, "method", choices=Payment.Method.values)
    if not partial or "amount" in payload:
        payment.amount = _int(payload, "amount", required=True, minimum=1)
    if "provider" in payload:
        payment.provider = _choice(
            payload, "provider", choices=Payment.Provider.values, required=False, default=""
        )
    if "mobileMoneyReference" in payload or "mobile_money_reference" in payload:
        payment.mobile_money_reference = _text(
            payload, "mobileMoneyReference", "mobile_money_reference", default="", max_length=60
        )
    if "confirmedAt" in payload or "confirmed_at" in payload:
        payment.confirmed_at = _timestamp(
            payload, "confirmedAt", "confirmed_at", default=None
        )
    if "matchedTxnId" in payload or "matched_txn_id" in payload:
        payment.matched_txn_id = _text(
            payload, "matchedTxnId", "matched_txn_id", default="", max_length=64
        )
    payment.updated_at = ids["updated_at"]
    payment.save()
    return payment


def upsert_mobile_money_txn(payload: dict, shop: Shop, *, partial=False) -> MobileMoneyTxn:
    ids = _record(payload)
    txn = MobileMoneyTxn.objects.filter(id=ids["id"]).first()
    if txn and txn.shop_id != shop.id:
        raise SyncError("That payment belongs to another shop.")
    if txn is None:
        txn = MobileMoneyTxn(
            id=ids["id"],
            shop=shop,
            created_at=ids["created_at"],
            provider=_choice(payload, "provider", choices=MobileMoneyTxn.Provider.values),
            amount=_int(payload, "amount", required=True, minimum=1),
            received_at=_timestamp(payload, "receivedAt", "received_at"),
        )
    if not partial or "provider" in payload:
        txn.provider = _choice(payload, "provider", choices=MobileMoneyTxn.Provider.values)
    if not partial or "amount" in payload:
        txn.amount = _int(payload, "amount", required=True, minimum=1)
    if "sender" in payload:
        txn.sender = _text(payload, "sender", default="", max_length=15)
    if "reference" in payload:
        txn.reference = _text(payload, "reference", default="", max_length=60)
    if "receivedAt" in payload or "received_at" in payload:
        txn.received_at = _timestamp(payload, "receivedAt", "received_at")
    if "rawMessage" in payload or "raw_message" in payload:
        txn.raw_message = _text(payload, "rawMessage", "raw_message", default="")
    if "parsed" in payload:
        txn.parsed = _bool(payload, "parsed", default=True)
    if "status" in payload:
        txn.status = _choice(payload, "status", choices=MobileMoneyTxn.Status.values)
    txn.updated_at = ids["updated_at"]
    txn.save()
    return txn


def upsert_reconciliation(payload: dict, shop: Shop, *, partial=False) -> Reconciliation:
    ids = _record(payload)
    row = Reconciliation.objects.filter(id=ids["id"]).first()
    if row and row.shop_id != shop.id:
        raise SyncError("That reconciliation belongs to another shop.")
    if row is None:
        day = _date(payload, "day", required=True)
        row = Reconciliation(id=ids["id"], shop=shop, day=day, created_at=ids["created_at"])
        partial = False
    elif "day" in payload:
        day = _date(payload, "day", required=True)
        if Reconciliation.objects.filter(shop=shop, day=day).exclude(id=row.id).exists():
            raise SyncError("There is already a reconciliation for that day.")
        row.day = day
    if not partial or "matchedCount" in payload or "matched_count" in payload:
        row.matched_count = _int(payload, "matchedCount", "matched_count", default=0, minimum=0)
    if not partial or "saleNoPaymentCount" in payload or "sale_no_payment_count" in payload:
        row.sale_no_payment_count = _int(
            payload, "saleNoPaymentCount", "sale_no_payment_count", default=0, minimum=0
        )
    if not partial or "paymentNoSaleCount" in payload or "payment_no_sale_count" in payload:
        row.payment_no_sale_count = _int(
            payload, "paymentNoSaleCount", "payment_no_sale_count", default=0, minimum=0
        )
    if not partial or "openingFloat" in payload or "opening_float" in payload:
        row.opening_float = _int(payload, "openingFloat", "opening_float", default=0, minimum=0)
    if "countedCash" in payload or "counted_cash" in payload:
        value = _get(payload, "countedCash", "counted_cash")
        row.counted_cash = None if value is None else _int(payload, "countedCash", "counted_cash", minimum=0)
    if not partial or "expectedCash" in payload or "expected_cash" in payload:
        row.expected_cash = _int(
            payload, "expectedCash", "expected_cash", default=0, minimum=0
        )
    if "note" in payload:
        row.note = _text(payload, "note", default="", max_length=255)
    row.updated_at = ids["updated_at"]
    row.save()
    return row


def upsert_tax_period(payload: dict, shop: Shop, *, partial=False) -> TaxPeriod:
    ids = _record(payload)
    row = TaxPeriod.objects.filter(id=ids["id"]).first()
    if row and row.shop_id != shop.id:
        raise SyncError("That tax period belongs to another shop.")
    if row is None:
        row = TaxPeriod(
            id=ids["id"],
            shop=shop,
            created_at=ids["created_at"],
            starts_on=_date(payload, "startsOn", "starts_on"),
            ends_on=_date(payload, "endsOn", "ends_on"),
            due_on=_date(payload, "dueOn", "due_on"),
        )
    for keys in (("startsOn", "starts_on"), ("endsOn", "ends_on"), ("dueOn", "due_on")):
        if not partial or any(key in payload for key in keys):
            setattr(row, keys[1].lower(), _date(payload, *keys))
    if not partial or "turnover" in payload:
        row.turnover = _int(payload, "turnover", default=0, minimum=0)
    if "rateUsed" in payload or "rate_used" in payload:
        value = _get(payload, "rateUsed", "rate_used", default=0)
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise SyncError("rateUsed must be a number.")
        if not 0 <= value <= 1:
            raise SyncError("rateUsed is a fraction, like 0.05 for 5%.")
        row.rate_used = value
    if not partial or "estimatedTax" in payload or "estimated_tax" in payload:
        row.estimated_tax = _int(
            payload, "estimatedTax", "estimated_tax", default=0, minimum=0
        )
    if "paid" in payload:
        row.paid = _bool(payload, "paid", default=False)
    row.updated_at = ids["updated_at"]
    row.save()
    return row


def upsert_tax_pot_entry(payload: dict, shop: Shop) -> TaxPotEntry:
    ids = _record(payload)
    row = TaxPotEntry.objects.filter(id=ids["id"]).first()
    if row and row.shop_id != shop.id:
        raise SyncError("That TaxPot entry belongs to another shop.")
    if row is None:
        period_id = _text(payload, "periodId", "period_id", required=True, max_length=64)
        period = TaxPeriod.objects.filter(id=period_id, shop=shop).first()
        if period is None:
            raise SyncError("periodId does not exist in this shop.")
        row = TaxPotEntry(
            id=ids["id"],
            shop=shop,
            period=period,
            created_at=ids["created_at"],
            amount=_int(payload, "amount", required=True),
            kind=_choice(payload, "kind", choices=TaxPotEntry.Kind.values),
        )
    if "amount" in payload:
        row.amount = _int(payload, "amount")
    if "kind" in payload:
        row.kind = _choice(payload, "kind", choices=TaxPotEntry.Kind.values)
    if "periodId" in payload or "period_id" in payload:
        period_id = _text(payload, "periodId", "period_id", required=True, max_length=64)
        period = TaxPeriod.objects.filter(id=period_id, shop=shop).first()
        if period is None:
            raise SyncError("periodId does not exist in this shop.")
        row.period = period
    if "saleId" in payload or "sale_id" in payload:
        row.sale_id = _text(payload, "saleId", "sale_id", default="", max_length=64)
    row.updated_at = ids["updated_at"]
    row.save()
    return row


def apply_change(change: dict, user: User, queue_id: str = "", shop_id: str | None = None) -> Shop:
    """Validate and upsert one change. Raises SyncError with a phone-readable reason.

    ``shop_id`` is the phone's shop (the X-Shop-ID header). Without it the
    user's first shop is used, which is only safe while each owner has one.
    """
    entity = _text(change, "entity", required=True, max_length=32)
    entity_id = _text(change, "entityId", "entity_id", required=True, max_length=64)
    operation = _text(change, "operation", required=True, max_length=8)
    if operation not in ("create", "update"):
        raise SyncError("operation must be create or update.")
    payload = change.get("payload")
    if not isinstance(payload, dict):
        raise SyncError("payload must be an object.")

    if queue_id:
        # Staff push to the owner's shop, so a replay is recognised across every
        # shop the user can use, not only the ones they own.
        prior = SyncChange.objects.filter(queue_id=queue_id, shop__in=user_shops(user)).first()
        if prior:
            # A replayed queue row is already applied. Return without writing so
            # the phone gets the same accepted answer and no duplicate pull row.
            return prior.shop

    client_created = None
    raw_created = _get(change, "clientCreatedAt", "client_created_at")
    if raw_created:
        client_created = _timestamp(change, "clientCreatedAt", "client_created_at")

    with transaction.atomic():
        if entity == "shop":
            if shop_id and _get(payload, "id") not in (None, shop_id):
                raise SyncError("This change belongs to another shop.")
            shop = upsert_shop(payload, user)
        else:
            row_shop = _get(payload, "shopId", "shop_id")
            if shop_id and row_shop and row_shop != shop_id:
                raise SyncError("This change belongs to another shop.")
            shop = resolve_shop(user, row_shop or shop_id)
            shop = _require_shop(shop)
            owner = is_owner(user, shop)
            if (
                owner
                and entity == "sale"
                and operation == "create"
                and not Sale.objects.filter(id=entity_id).exists()
                and not owner_may_record_sale(user, _record(_sale_body(payload, entity_id))["created_at"])
            ):
                raise SyncError(OWNER_SALE_REFUSED)
            if not owner:
                check_staff_change(entity, operation, payload, entity_id, shop)
            if entity == "product":
                upsert_product(payload, shop, partial=operation == "update")
            elif entity == "product_variant":
                upsert_variant(payload, shop, partial=operation == "update")
            elif entity == "stock_movement":
                if operation == "update":
                    raise SyncError("Stock movements are append-only.")
                insert_movement(payload, shop, existing_is_ok=True)
            elif entity == "sale":
                sale = upsert_sale(payload, shop, entity_id, user, owner=owner)
                # Sent to Smart Invoice once the sale is safely stored.
                from apps.smartinvoice.services import send_sale

                transaction.on_commit(lambda sale=sale: send_sale(sale))
            elif entity == "payment":
                upsert_payment(payload, shop, partial=operation == "update")
            elif entity == "mobile_money_txn":
                upsert_mobile_money_txn(payload, shop, partial=operation == "update")
            elif entity == "reconciliation":
                upsert_reconciliation(payload, shop, partial=operation == "update")
            elif entity == "tax_period":
                upsert_tax_period(payload, shop, partial=operation == "update")
            elif entity == "tax_pot_entry":
                upsert_tax_pot_entry(payload, shop)
            else:
                raise SyncError(f"Unknown entity '{entity}'.")

        SyncChange.objects.create(
            shop=shop,
            queue_id=queue_id,
            entity=entity,
            entity_id=entity_id,
            operation=operation,
            payload=payload,
            client_created_at=client_created,
        )
        return shop


def cursor_value(raw) -> int:
    if raw in (None, "", "0"):
        return 0
    text = str(raw)
    text = text.removeprefix("c_")
    try:
        return max(0, int(text))
    except (TypeError, ValueError):
        raise SyncError("cursor must be an integer or c_<integer>.")


def pull_changes(user: User, cursor: int, limit: int, shop_id: str | None = None):
    qs = SyncChange.objects.filter(shop__in=user_shops(user), id__gt=cursor).select_related("shop")
    if shop_id:
        qs = qs.filter(shop_id=shop_id)
    rows = list(qs.order_by("id")[:limit])
    changes = []
    for row in rows:
        # The cursor still advances past rows a staff phone may not see.
        payload = row.payload if is_owner(user, row.shop) else staff_payload(row.entity, row.payload)
        if payload is None:
            continue
        changes.append(
            {
                "entity": row.entity,
                "entityId": row.entity_id,
                "operation": row.operation,
                "payload": payload,
                "cursor": str(row.id),
                "clientCreatedAt": (row.client_created_at or row.created_at).isoformat(),
            }
        )
    next_cursor = str(rows[-1].id) if rows else str(cursor)
    return changes, next_cursor
