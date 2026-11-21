from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class PaymentRequest(TimeStampedModel):
    """A "request to pay": the shop asks the customer's wallet for money and
    the customer approves it with their PIN on their own phone.

    The phone makes the id, so a retried request after a dropped connection
    finds the same row instead of charging the customer twice.
    """

    class Provider(models.TextChoices):
        MTN = "MTN", "MTN"
        AIRTEL = "Airtel", "Airtel"
        ZAMTEL = "Zamtel", "Zamtel"

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for the customer"
        SUCCESSFUL = "successful", "Paid"
        FAILED = "failed", "Declined or failed"
        EXPIRED = "expired", "No answer in time"

    id = models.CharField(primary_key=True, max_length=64)
    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="payment_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payment_requests"
    )
    provider = models.CharField(max_length=8, choices=Provider.choices)
    phone = models.CharField(max_length=15)
    amount_ngwee = models.PositiveIntegerField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    provider_reference = models.CharField(max_length=80, blank=True)
    reason = models.CharField(max_length=200, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["shop", "status"])]

    @property
    def is_final(self) -> bool:
        return self.status != self.Status.PENDING
