from django.contrib import admin

from .models import TradingRecord


@admin.register(TradingRecord)
class TradingRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "shop", "period_start", "period_end", "issued_at", "expires_at", "revoked_at", "view_count")
    list_filter = ("period_months",)
    # The payload is sealed: editing it here would make the public page say "tampered".
    readonly_fields = [f.name for f in TradingRecord._meta.fields]
