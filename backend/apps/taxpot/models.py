from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum

from apps.core.models import TimeStampedModel


class Wallet(TimeStampedModel):
    """SIMULATED savings wallet. No real money is held or moved: real custody or payment to ZRA
    would need an authorised financial-service arrangement."""

    shop = models.OneToOneField("shops.Shop", on_delete=models.CASCADE, related_name="wallet")
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))


class SavingsTarget(TimeStampedModel):
    class Approach(models.TextChoices):
        DAILY = "daily", "A little every day"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        MANUAL = "manual", "Whenever I choose"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="savings_targets")
    name = models.CharField(max_length=150)
    target_amount = models.DecimalField(max_digits=14, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    approach = models.CharField(max_length=8, choices=Approach.choices, default=Approach.MANUAL)
    estimate = models.ForeignKey(
        "tax.TaxEstimate", null=True, blank=True, on_delete=models.SET_NULL, related_name="targets"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["due_date", "-created_at"]

    def saved_amount(self):
        return self.transactions.filter(kind=TaxPotTransaction.Kind.DEPOSIT).aggregate(t=Sum("amount"))["t"] or Decimal("0")


class TaxPotTransaction(TimeStampedModel):
    class Kind(models.TextChoices):
        DEPOSIT = "deposit", "Saved"
        TAX_PAYMENT = "tax_payment", "Tax payment (simulated)"

    class Source(models.TextChoices):
        SUGGESTED = "suggested", "Suggested amount"
        VOLUNTARY = "voluntary", "Own amount"
        USSD = "ussd", "USSD"

    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name="transactions")
    target = models.ForeignKey(SavingsTarget, null=True, blank=True, on_delete=models.SET_NULL, related_name="transactions")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.VOLUNTARY)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    is_simulated = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at", "-id"]


class SuggestionLog(TimeStampedModel):
    """The owner may accept, change or skip each suggestion; we keep what they chose."""

    class Action(models.TextChoices):
        ACCEPTED = "accepted", "Accepted"
        CHANGED = "changed", "Changed"
        SKIPPED = "skipped", "Skipped"

    target = models.ForeignKey(SavingsTarget, on_delete=models.CASCADE, related_name="suggestion_logs")
    suggested_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    action = models.CharField(max_length=8, choices=Action.choices)
    actual_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
