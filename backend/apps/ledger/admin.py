from django.contrib import admin

from .models import LedgerEntry


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("entry_date", "shop", "entry_type", "category", "amount", "verification", "is_void")
    list_filter = ("entry_type", "verification", "source", "is_void")
