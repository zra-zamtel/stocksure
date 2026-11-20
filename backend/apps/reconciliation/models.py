from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class DailyClose(TimeStampedModel):
    """End-of-day cash-up: expected cash (from recorded cash sales) vs the cash the assistant counted."""

    class Status(models.TextChoices):
        BALANCED = "balanced", "Balanced"
        SHORT = "short", "Cash short"
        OVER = "over", "Cash over"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="daily_closes")
    date = models.DateField()
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2)
    declared_cash = models.DecimalField(max_digits=12, decimal_places=2)
    gap = models.DecimalField(max_digits=12, decimal_places=2, help_text="declared - expected")
    status = models.CharField(max_length=8, choices=Status.choices)
    tolerance_applied = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_sales_count = models.PositiveIntegerField(default=0)
    mobile_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    mobile_sales_count = models.PositiveIntegerField(default=0)
    unmatched_mobile_sales = models.PositiveIntegerField(default=0)
    unmatched_payments = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["shop", "date"], name="one_close_per_day")]
