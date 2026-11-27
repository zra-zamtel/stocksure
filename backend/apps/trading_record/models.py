import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.sync.models import Shop


class TradingRecord(models.Model):
    """A sealed summary of a shop's trading that the owner chose to share.

    The server computes ``payload`` from the records the phone synced and seals
    it with ``payload_hash`` (SHA-256 over canonical JSON). The share token is
    only ever shown once, at issue; the server keeps its hash, so a database
    leak does not leak working links. Aggregates only: no customer names, payer
    numbers or product rows ever go into the payload.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="trading_records")
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    period_months = models.PositiveSmallIntegerField()
    period_start = models.DateField()
    period_end = models.DateField()
    include_margin = models.BooleanField(default=False)
    include_tax = models.BooleanField(default=False)
    payload = models.JSONField()
    payload_hash = models.CharField(max_length=64)
    token_hash = models.CharField(max_length=64, unique=True)
    issued_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)
    last_viewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-issued_at"]

    def __str__(self):
        return f"Trading record {self.id} ({self.shop})"

    def state(self, now=None) -> str:
        now = now or timezone.now()
        if self.revoked_at:
            return "revoked"
        if now >= self.expires_at:
            return "expired"
        return "valid"
