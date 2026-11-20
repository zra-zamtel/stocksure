from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class Shop(TimeStampedModel):
    class Mode(models.TextChoices):
        LITE = "lite", "Lite (sales and money only)"
        FULL = "full", "Full (adds stock, complete three-way match)"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_shops")
    name = models.CharField(max_length=150)
    town = models.CharField(max_length=80, blank=True)
    address = models.CharField(max_length=255, blank=True)
    mode = models.CharField(max_length=4, choices=Mode.choices, default=Mode.LITE)
    tpin = models.CharField("TPIN", max_length=20, blank=True)
    zamtel_merchant_number = models.CharField(max_length=15, blank=True)
    # Cash gap (ZMW) allowed at daily close before it is flagged. 0 = any gap is flagged.
    cash_tolerance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name

    @property
    def is_full(self):
        return self.mode == self.Mode.FULL


class Membership(TimeStampedModel):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ASSISTANT = "assistant", "Assistant"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "shop"], name="uniq_member_per_shop")]

    def __str__(self):
        return f"{self.user} @ {self.shop} ({self.role})"
