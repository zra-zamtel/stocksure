from django.db import models

from apps.sync.models import Sale, Shop


class SmartInvoiceLink(models.Model):
    """A shop connected to Smart Invoice through StockSure.

    StockSure does the paperwork a trader would otherwise face (apply for a
    VSDC, wait for approval, install software): the owner gives a TPIN once and
    every sale is sent from then on. ``simulated`` stays True until a real,
    ZRA-certified VSDC is wired in.
    """

    shop = models.OneToOneField(Shop, on_delete=models.CASCADE, related_name="smart_invoice")
    tpin = models.CharField(max_length=10)
    branch_id = models.CharField(max_length=3, default="000")
    device_serial = models.CharField(max_length=40)
    taxpayer_name = models.CharField(max_length=150)
    sdc_id = models.CharField(max_length=20)
    mrc_no = models.CharField(max_length=20)
    simulated = models.BooleanField(default=True)
    next_invoice_no = models.PositiveIntegerField(default=1)
    connected_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.shop} -> Smart Invoice ({self.tpin})"


class SmartInvoiceReceipt(models.Model):
    """One invoice sent for a sale: the sale itself (S) or its refund (R)."""

    class Type(models.TextChoices):
        SALE = "S", "Sale"
        REFUND = "R", "Refund after sale"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="smart_invoice_receipts")
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="smart_invoice_receipts")
    receipt_type = models.CharField(max_length=1, choices=Type.choices)
    invoice_no = models.PositiveIntegerField()
    original_invoice_no = models.PositiveIntegerField(default=0)
    # What was sent, exactly as the VSDC saveSales request expects it.
    request = models.JSONField()
    result_code = models.CharField(max_length=3)
    result_message = models.CharField(max_length=200, blank=True)
    receipt_no = models.PositiveIntegerField(null=True, blank=True)
    total_receipt_no = models.PositiveIntegerField(null=True, blank=True)
    internal_data = models.CharField(max_length=64, blank=True)
    receipt_signature = models.CharField(max_length=64, blank=True)
    sdc_id = models.CharField(max_length=20, blank=True)
    mrc_no = models.CharField(max_length=20, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    simulated = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["sale", "receipt_type"], name="uniq_si_receipt_per_sale_type"),
            models.UniqueConstraint(fields=["shop", "invoice_no"], name="uniq_si_invoice_no"),
        ]
