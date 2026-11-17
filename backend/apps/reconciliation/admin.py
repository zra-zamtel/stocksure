from django.contrib import admin

from .models import DailyClose


@admin.register(DailyClose)
class DailyCloseAdmin(admin.ModelAdmin):
    list_display = ("date", "shop", "expected_cash", "declared_cash", "gap", "status")
    list_filter = ("status", "shop")
