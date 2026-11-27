from django.conf import settings
from django.db import models


class PhoneRecord(models.Model):
    """A row the phone owns. The primary key and both timestamps come from the
    phone; the server upserts on the id so a replayed batch is a no-op."""

    id = models.CharField(max_length=64, primary_key=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        abstract = True


class Shop(PhoneRecord):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_shops"
    )
    name = models.CharField(max_length=150)
    type = models.CharField(max_length=20, default="other")
    # The trade profile (fashion, health_beauty, bar...). Free text on purpose:
    # a new trade on the phone must not need a server migration.
    profile_id = models.CharField(max_length=30, default="general")
    town = models.CharField(max_length=80, blank=True)
    currency = models.CharField(max_length=3, default="ZMW")
    language = models.CharField(max_length=2, default="en")
    uses_barcodes = models.BooleanField(default=False)
    low_stock_default = models.PositiveIntegerField(default=3)
    turnover_tax_registered = models.BooleanField(default=False)
    tpin = models.CharField(max_length=20, blank=True)
    providers_json = models.JSONField(default=list)
    onboarding_completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.name


class Product(PhoneRecord):
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="products")
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=80, blank=True)
    photo_uri = models.CharField(max_length=255, blank=True)
    default_buy_price = models.PositiveIntegerField(default=0)  # ngwee
    default_sell_price = models.PositiveIntegerField(default=0)  # ngwee
    discount_json = models.JSONField(null=True, blank=True)
    unit = models.CharField(max_length=20, blank=True)
    # Confirmed on the phone before a sale, e.g. "Rx only" or "18+".
    sale_warning = models.CharField(max_length=60, blank=True)

    def __str__(self):
        return self.name


class ProductVariant(PhoneRecord):
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="variants")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    size = models.CharField(max_length=20, blank=True)
    colour = models.CharField(max_length=40, blank=True)
    barcode = models.CharField(max_length=64, blank=True)
    buy_price = models.PositiveIntegerField(default=0)  # ngwee
    sell_price = models.PositiveIntegerField(default=0)  # ngwee
    low_stock_level = models.PositiveIntegerField(default=3)
    expiry_date = models.DateField(null=True, blank=True)
    batch_no = models.CharField(max_length=60, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["shop", "barcode"], condition=~models.Q(barcode=""), name="uniq_sync_barcode"
            )
        ]

    @property
    def quantity(self) -> int:
        return self.movements.aggregate(total=models.Sum("quantity_change"))["total"] or 0

    def __str__(self):
        return f"{self.product.name} {self.size}".strip()


class StockMovement(PhoneRecord):
    class Reason(models.TextChoices):
        OPENING = "opening", "Opening"
        RESTOCK = "restock", "Restock"
        SALE = "sale", "Sale"
        VOID = "void", "Void"
        CORRECTION = "correction", "Correction"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="stock_movements")
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="movements")
    quantity_change = models.IntegerField()
    reason = models.CharField(max_length=10, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    sale_id = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(quantity_change=0), name="sync_movement_not_zero"
            )
        ]


class Sale(PhoneRecord):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        VOID = "void", "Void"

    class Reconcile(models.TextChoices):
        MATCHED = "matched", "Matched"
        SALE_NO_PAYMENT = "sale_no_payment", "Sale without payment"
        PAYMENT_NO_SALE = "payment_no_sale", "Payment without sale"
        UNRESOLVED = "unresolved", "Unresolved"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="sales")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    subtotal = models.PositiveIntegerField(default=0)  # ngwee
    discount_total = models.PositiveIntegerField(default=0)  # ngwee
    total = models.PositiveIntegerField(default=0)  # ngwee
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    void_reason = models.CharField(max_length=255, blank=True)
    reconcile_status = models.CharField(
        max_length=20, choices=Reconcile.choices, default=Reconcile.UNRESOLVED
    )

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"Sale {self.id}"


class SaleLine(PhoneRecord):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="sale_lines")
    quantity = models.PositiveIntegerField()
    buy_price = models.PositiveIntegerField(default=0)  # ngwee, per unit
    list_price = models.PositiveIntegerField(default=0)  # ngwee, line total before discount
    discount = models.PositiveIntegerField(default=0)  # ngwee, line total
    final_price = models.PositiveIntegerField(default=0)  # ngwee, line total after discount


class Payment(PhoneRecord):
    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE_MONEY = "mobile_money", "Mobile money"

    class Provider(models.TextChoices):
        MTN = "MTN", "MTN"
        AIRTEL = "Airtel", "Airtel"
        ZAMTEL = "Zamtel", "Zamtel"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="payments")
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments")
    method = models.CharField(max_length=12, choices=Method.choices)
    provider = models.CharField(max_length=8, choices=Provider.choices, blank=True)
    amount = models.PositiveIntegerField()  # ngwee
    mobile_money_reference = models.CharField(max_length=60, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    matched_txn_id = models.CharField(max_length=64, blank=True)


class MobileMoneyTxn(PhoneRecord):
    class Provider(models.TextChoices):
        MTN = "MTN", "MTN"
        AIRTEL = "Airtel", "Airtel"
        ZAMTEL = "Zamtel", "Zamtel"

    class Status(models.TextChoices):
        UNMATCHED = "unmatched", "Unmatched"
        MATCHED = "matched", "Matched"
        IGNORED = "ignored", "Ignored"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="mobile_money_txns")
    provider = models.CharField(max_length=8, choices=Provider.choices)
    amount = models.PositiveIntegerField()  # ngwee
    sender = models.CharField(max_length=15, blank=True)
    reference = models.CharField(max_length=60, blank=True)
    received_at = models.DateTimeField()
    raw_message = models.TextField(blank=True)
    parsed = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UNMATCHED)


class Reconciliation(PhoneRecord):
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="reconciliations")
    day = models.DateField()
    matched_count = models.PositiveIntegerField(default=0)
    sale_no_payment_count = models.PositiveIntegerField(default=0)
    payment_no_sale_count = models.PositiveIntegerField(default=0)
    opening_float = models.PositiveIntegerField(default=0)  # ngwee
    counted_cash = models.PositiveIntegerField(null=True, blank=True)  # ngwee
    expected_cash = models.PositiveIntegerField(default=0)  # ngwee
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["shop", "day"], name="uniq_sync_close_day")]


class TaxPeriod(PhoneRecord):
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="tax_periods")
    starts_on = models.DateField()
    ends_on = models.DateField()
    turnover = models.PositiveIntegerField(default=0)  # ngwee
    rate_used = models.DecimalField(max_digits=7, decimal_places=4, default=0)
    estimated_tax = models.PositiveIntegerField(default=0)  # ngwee
    due_on = models.DateField()
    paid = models.BooleanField(default=False)


class TaxPotEntry(PhoneRecord):
    class Kind(models.TextChoices):
        SET_ASIDE = "set_aside", "Set aside"
        TOP_UP = "top_up", "Top up"
        PAID = "paid", "Paid to ZRA"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="tax_pot_entries")
    amount = models.IntegerField()  # ngwee
    kind = models.CharField(max_length=10, choices=Kind.choices)
    period = models.ForeignKey(TaxPeriod, on_delete=models.CASCADE, related_name="pot_entries")
    sale_id = models.CharField(max_length=64, blank=True)


class SyncChange(models.Model):
    """Pull log. The sequence is server-generated and is only a cursor; it is
    not a synced record id."""

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="changes")
    queue_id = models.CharField(max_length=64, blank=True, db_index=True)
    entity = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=64)
    operation = models.CharField(max_length=8)
    payload = models.JSONField()
    client_created_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            # A phone's outbox row is applied once per shop, even if two
            # requests race; server-made rows (USSD) have no queue id.
            models.UniqueConstraint(
                fields=["shop", "queue_id"],
                condition=~models.Q(queue_id=""),
                name="sync_change_unique_queue_id",
            )
        ]
