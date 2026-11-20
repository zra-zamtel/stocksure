from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import TimeStampedModel

DISCLAIMER = (
    "This is an estimate from your recorded sales. It is not an official ZRA assessment or tax advice. "
    "Confirm rates, limits and due dates with ZRA."
)


class TaxRuleSet(TimeStampedModel):
    """Versioned, configurable tax rules. Nothing is hard-coded in the estimator: a new law or rate
    is a new row with a new version and effective date, managed in the Django admin.

    A rule set must be validated against ZRA or authoritative current guidance before real use
    (see is_validated). Estimates made on unvalidated rules are labelled as such.
    """

    class Frequency(models.TextChoices):
        UNSPECIFIED = "unspecified", "Not specified"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        ANNUAL = "annual", "Annual"

    tax_type = models.CharField(max_length=30, default="turnover_tax")
    name = models.CharField(max_length=150)
    version = models.PositiveIntegerField()
    rate_percent = models.DecimalField(max_digits=7, decimal_places=4, help_text="e.g. 4 means 4%")
    annual_turnover_threshold = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="Upper turnover limit of this regime, if it has one (ZMW per year).",
    )
    filing_frequency = models.CharField(max_length=12, choices=Frequency.choices, default=Frequency.UNSPECIFIED)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    source_reference = models.TextField(blank=True, help_text="Where these figures come from (ZRA notice, URL, date).")
    is_validated = models.BooleanField(default=False)
    validated_by = models.CharField(max_length=150, blank=True)
    validated_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["tax_type", "-version"]
        constraints = [models.UniqueConstraint(fields=["tax_type", "version"], name="uniq_rule_version")]

    def clean(self):
        if self.is_validated and not (self.validated_by and self.source_reference and self.validated_on):
            raise ValidationError("To mark rules as validated, fill in validated by, validated on and the source reference.")
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError("'Effective to' cannot be before 'effective from'.")

    def __str__(self):
        flag = "validated" if self.is_validated else "UNVALIDATED"
        return f"{self.name} v{self.version} ({self.rate_percent}%, {flag})"


class TaxEstimate(TimeStampedModel):
    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="tax_estimates")
    rule_set = models.ForeignKey(TaxRuleSet, on_delete=models.PROTECT, related_name="estimates")
    period_start = models.DateField()
    period_end = models.DateField()
    verified_income = models.DecimalField(max_digits=14, decimal_places=2)
    reported_income = models.DecimalField(max_digits=14, decimal_places=2)
    include_unverified = models.BooleanField(default=True)
    basis_income = models.DecimalField(max_digits=14, decimal_places=2)
    rate_percent = models.DecimalField(max_digits=7, decimal_places=4)
    estimated_tax = models.DecimalField(max_digits=14, decimal_places=2)
    income_tax = models.BooleanField(default=False)
    year_to_date_turnover = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    rules_validated = models.BooleanField(default=False)
    assumptions = models.JSONField(default=list)
    warnings = models.JSONField(default=list)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
