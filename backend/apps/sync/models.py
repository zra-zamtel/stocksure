from django.conf import settings
from django.db import models


class SyncRecord(models.Model):
    """Current state of one synced row (as the phone stored it). The server never recomputes money:
    `data` is exactly what the phone sent, after validation.

    The few extra columns are index helpers pulled out of `data` so USSD can total sales and stock
    in the database without parsing JSON."""

    tenant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_records")
    entity = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=80)
    data = models.JSONField()
    updated_at_client = models.DateTimeField()
    event_at = models.DateTimeField(null=True, blank=True)   # the row's created_at
    ref_id = models.CharField(max_length=80, blank=True, default="")   # parent id (variant_id, sale_id, ...)
    unique_value = models.CharField(max_length=120, null=True, blank=True)  # barcode, staff phone, day, ...
    num = models.BigIntegerField(null=True, blank=True)       # quantity_change, sale total, payment amount, ...
    state = models.CharField(max_length=20, blank=True, default="")  # sale status
    last_seq = models.BigIntegerField(default=0)
    server_updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "entity", "entity_id"], name="uniq_record_per_tenant"),
            models.UniqueConstraint(
                fields=["tenant", "entity", "unique_value"],
                condition=models.Q(unique_value__isnull=False),
                name="uniq_unique_value_per_tenant",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "entity", "ref_id"]),
            models.Index(fields=["tenant", "entity", "event_at"]),
        ]

    def __str__(self):
        return f"{self.entity}:{self.entity_id}"


class ChangeLog(models.Model):
    """Append-only history of accepted changes. `seq` is the pull cursor: it only ever grows, and rows
    here are never edited or deleted, so a phone that restores from cursor 0 replays everything."""

    seq = models.BigAutoField(primary_key=True)
    tenant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    entity = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=80)
    operation = models.CharField(max_length=6)  # create | update
    payload = models.JSONField()
    device_id = models.CharField(max_length=80, blank=True, default="")
    batch_id = models.CharField(max_length=80, blank=True, default="")
    queue_id = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["tenant", "seq"])]

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise RuntimeError("ChangeLog is append-only: rows cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("ChangeLog is append-only: rows cannot be deleted.")
