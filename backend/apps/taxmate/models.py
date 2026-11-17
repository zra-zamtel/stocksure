from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel

DEFAULT_OFFICIAL_CHANNEL = (
    "For decisions about your tax, confirm with ZRA through its official channels "
    "(its website, helpline or a ZRA office)."
)


class ReviewedAnswer(TimeStampedModel):
    """TaxMate only ever answers from rows like this. An answer is served only after a person
    has reviewed it (is_reviewed). Nyanja text is added only once it has been reviewed too."""

    class Category(models.TextChoices):
        CONCEPTS = "concepts", "Tax concepts"
        RECORDS = "records", "Business records"
        TPIN = "tpin", "TPIN"
        REGISTRATION = "registration", "Registration"
        OBLIGATIONS = "obligations", "Obligations and due dates"
        SAVINGS = "savings", "Saving for tax"
        STOCKSURE = "stocksure", "Using StockSure"

    category = models.CharField(max_length=14, choices=Category.choices)
    question = models.CharField(max_length=255)
    keywords = models.TextField(help_text="Comma-separated words people use when asking this.")
    answer_en = models.TextField()
    answer_ny = models.TextField(blank=True, help_text="Nyanja. Leave empty until reviewed.")
    official_channel = models.TextField(default=DEFAULT_OFFICIAL_CHANNEL)
    is_reviewed = models.BooleanField(default=False)
    reviewed_by = models.CharField(max_length=150, blank=True)
    reviewed_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["category", "question"]

    def __str__(self):
        return self.question


class TaxMateQuery(TimeStampedModel):
    """Log of what owners ask. Unanswered questions show the team what content to write and review next."""

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    question = models.CharField(max_length=500)
    language = models.CharField(max_length=2, default="en")
    matched = models.ForeignKey(ReviewedAnswer, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    score = models.FloatField(default=0)
    answered = models.BooleanField(default=False)
