from django.contrib import admin

from .models import TaxEstimate, TaxRuleSet


@admin.register(TaxRuleSet)
class TaxRuleSetAdmin(admin.ModelAdmin):
    list_display = ("name", "tax_type", "version", "rate_percent", "effective_from", "effective_to", "is_validated", "is_active")
    list_filter = ("tax_type", "is_validated", "is_active")


@admin.register(TaxEstimate)
class TaxEstimateAdmin(admin.ModelAdmin):
    list_display = ("shop", "period_start", "period_end", "estimated_tax", "rules_validated", "created_at")
    list_filter = ("rules_validated",)
