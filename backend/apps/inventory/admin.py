from django.contrib import admin

from .models import InvoiceScan, Item, StockMovement, StockTake


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ("name", "size", "color", "shop", "price", "quantity", "label_code", "is_active")
    list_filter = ("shop", "is_active")
    search_fields = ("name", "label_code", "barcode")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("created_at", "shop", "item", "kind", "quantity_change", "balance_after")
    list_filter = ("kind", "shop")


admin.site.register(InvoiceScan)
admin.site.register(StockTake)
