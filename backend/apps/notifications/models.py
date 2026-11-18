from django.db import models

from apps.core.models import TimeStampedModel


class Notification(TimeStampedModel):
    """Every SMS the system sends (or would send) - also powers the 'SMS preview' screen."""

    class Kind(models.TextChoices):
        DAILY_GAP = "daily_gap", "Daily close gap"
        STOCK_SHORTAGE = "stock_shortage", "Stock-take shortage"
        MISSING_RECORD = "missing_record", "Missing record reminder"
        SAVINGS_REMINDER = "savings_reminder", "Savings reminder"
        TAX_DUE = "tax_due", "Tax due date reminder"
        SUMMARY = "summary", "Summary"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="notifications")
    recipient_phone = models.CharField(max_length=15)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    message = models.TextField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED)
    provider_message = models.CharField(max_length=255, blank=True)
    dedupe_key = models.CharField(max_length=120, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
