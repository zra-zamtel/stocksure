import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel


def generate_label_code(shop_id):
    """Short unique code printed as a QR/barcode label (clothes and shoes rarely have factory barcodes)."""
    return f"SS{shop_id}-{secrets.token_hex(3).upper()}"


class Item(TimeStampedModel):
    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=80, blank=True)
    size = models.CharField(max_length=20, blank=True)
    color = models.CharField(max_length=40, blank=True)
    barcode = models.CharField("factory barcode", max_length=64, blank=True)
    label_code = models.CharField(max_length=32, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    cost_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Current stock level. Only ever changed through inventory.services.apply_movement.
    quantity = models.IntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=0)
    photo = models.ImageField(upload_to="items/%Y/%m/", null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "size"]
        constraints = [
            models.UniqueConstraint(fields=["shop", "label_code"], name="uniq_label_per_shop"),
            models.UniqueConstraint(
                fields=["shop", "barcode"], condition=~Q(barcode=""), name="uniq_barcode_per_shop"
            ),
        ]
        indexes = [models.Index(fields=["shop", "is_active"])]

    def save(self, *args, **kwargs):
        if not self.label_code:
            code = generate_label_code(self.shop_id)
            while Item.objects.filter(shop_id=self.shop_id, label_code=code).exists():
                code = generate_label_code(self.shop_id)
            self.label_code = code
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        extra = " ".join(p for p in (self.color, f"size {self.size}" if self.size else "") if p)
        return f"{self.name} ({extra})" if extra else self.name

    def __str__(self):
        return self.display_name


class StockMovement(TimeStampedModel):
    """Append-only history of every change to an item's quantity. This is what stock-taking audits."""

    class Kind(models.TextChoices):
        OPENING = "opening", "Opening stock"
        DELIVERY = "delivery", "Delivery received"
        SALE = "sale", "Sale"
        SALE_VOID = "sale_void", "Sale voided"
        ADJUSTMENT = "adjustment", "Manual adjustment"
        STOCKTAKE = "stocktake", "Stock-take correction"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="stock_movements")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="movements")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    quantity_change = models.IntegerField()
    balance_after = models.IntegerField()
    reference = models.CharField(max_length=60, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at", "-id"]


class InvoiceScan(TimeStampedModel):
    """A supplier invoice photo. The reader proposes items; nothing changes stock until confirmed."""

    class Status(models.TextChoices):
        PARSED = "parsed", "Read - waiting for review"
        CONFIRMED = "confirmed", "Confirmed"
        FAILED = "failed", "Could not read"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="invoice_scans")
    image = models.ImageField(upload_to="invoices/%Y/%m/")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PARSED)
    parsed_items = models.JSONField(default=list, blank=True)
    error = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)


class StockTake(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "In progress"
        CLOSED = "closed", "Closed"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="stock_takes")
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.OPEN)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    adjustments_applied = models.BooleanField(default=False)
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["shop"], condition=Q(status="open"), name="one_open_stocktake_per_shop"
            )
        ]


class StockTakeLine(models.Model):
    stock_take = models.ForeignKey(StockTake, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.RESTRICT, related_name="+")
    expected_qty = models.IntegerField()
    counted_qty = models.IntegerField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["stock_take", "item"], name="uniq_line_per_item")]

    @property
    def difference(self):
        return None if self.counted_qty is None else self.counted_qty - self.expected_qty
