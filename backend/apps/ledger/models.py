from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class LedgerEntry(TimeStampedModel):
    class Type(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    class Category(models.TextChoices):
        SALES = "sales", "Sales"
        OTHER_INCOME = "other_income", "Other income"
        STOCK_PURCHASE = "stock_purchase", "Stock purchase"
        RENT = "rent", "Rent"
        SALARIES = "salaries", "Salaries"
        TRANSPORT = "transport", "Transport"
        UTILITIES = "utilities", "Utilities"
        OTHER_EXPENSE = "other_expense", "Other expense"

    class Source(models.TextChoices):
        SALE = "sale", "From a recorded sale"
        MANUAL = "manual", "Typed in by hand"

    class Verification(models.TextChoices):
        VERIFIED = "verified", "Verified"
        TRADER_REPORTED = "trader_reported", "Trader-reported"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="ledger_entries")
    entry_type = models.CharField(max_length=8, choices=Type.choices)
    category = models.CharField(max_length=20, choices=Category.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=255, blank=True)
    entry_date = models.DateField(db_index=True)
    source = models.CharField(max_length=6, choices=Source.choices, default=Source.MANUAL)
    verification = models.CharField(
        max_length=16, choices=Verification.choices, default=Verification.TRADER_REPORTED
    )
    sale = models.OneToOneField(
        "sales.Sale", null=True, blank=True, on_delete=models.CASCADE, related_name="ledger_entry"
    )
    is_void = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-entry_date", "-id"]
        indexes = [models.Index(fields=["shop", "entry_date"])]

    def __str__(self):
        return f"{self.entry_type} {self.amount} on {self.entry_date}"
