from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from . import validators as v


class ConfigVersion(models.Model):
    """One version of a config file the app refreshes without a new release: tax rules, or the English /
    Nyanja language text. Edited in the Django admin. Only published versions are served, and a file
    that fails validation cannot be saved at all."""

    KIND_CHOICES = [
        (v.TAX_RULES, "Tax rules"),
        (v.LANG_EN, "Language: English"),
        (v.LANG_NY, "Language: Nyanja"),
    ]

    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    version = models.PositiveIntegerField()
    payload = models.JSONField(help_text="Tax rules: the TaxRules object. Language: flat {key: text}.")
    checksum = models.CharField(max_length=64, editable=False)
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True, editable=False)
    validated_with_zra = models.BooleanField(
        default=False, help_text="Tick only after the figures are confirmed against ZRA's published rules."
    )
    source_note = models.TextField(blank=True, help_text="Where the figures or translations come from, and who checked them.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["kind", "-version"]
        constraints = [models.UniqueConstraint(fields=["kind", "version"], name="uniq_config_version")]

    def __str__(self):
        flag = "published" if self.is_published else "draft"
        extra = ""
        if self.kind == v.TAX_RULES and not self.validated_with_zra:
            extra = ", NOT validated with ZRA"
        return f"{self.get_kind_display()} v{self.version} ({flag}{extra})"

    def _previous_keys(self):
        prev = (
            ConfigVersion.objects.filter(kind=self.kind, is_published=True, version__lt=self.version)
            .order_by("-version").first()
        )
        return list(prev.payload) if prev and isinstance(prev.payload, dict) else None

    def validate_payload(self):
        if self.kind == v.TAX_RULES:
            v.validate_tax_rules(self.payload, self.version)
        elif self.kind in (v.LANG_EN, v.LANG_NY):
            v.validate_language(self.payload, self._previous_keys() if self.is_published else None)
        else:
            raise ValidationError("Unknown config kind.")

    def clean(self):
        self.validate_payload()

    def save(self, *args, **kwargs):
        self.validate_payload()  # also protects scripts and the shell, not just the admin form
        self.checksum = v.checksum(self.payload)
        if self.is_published and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

    @classmethod
    def latest_published(cls, kind):
        return cls.objects.filter(kind=kind, is_published=True).order_by("-version").first()

    def as_response(self):
        return {
            "kind": self.kind, "version": self.version, "checksum": self.checksum,
            "validatedWithZra": self.validated_with_zra if self.kind == v.TAX_RULES else None,
            "publishedAt": self.published_at.isoformat() if self.published_at else None,
            "payload": self.payload,
        }
