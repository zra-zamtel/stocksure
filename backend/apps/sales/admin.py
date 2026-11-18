from django.contrib import admin

from .models import MobilePayment, Sale, SaleLine


class SaleLineInline(admin.TabularInline):
    model = SaleLine
    extra = 0


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("id", "shop", "sold_at", "payment_method", "total", "status", "match_status")
    list_filter = ("shop", "payment_method", "status", "match_status")
    inlines = [SaleLineInline]


@admin.register(MobilePayment)
class MobilePaymentAdmin(admin.ModelAdmin):
    list_display = ("provider_ref", "shop", "amount", "received_at", "status", "source")
    list_filter = ("status", "source")
