from django.contrib import admin

from .models import SmartInvoiceLink, SmartInvoiceReceipt


@admin.register(SmartInvoiceLink)
class SmartInvoiceLinkAdmin(admin.ModelAdmin):
    list_display = ("shop", "tpin", "sdc_id", "simulated", "connected_at")


@admin.register(SmartInvoiceReceipt)
class SmartInvoiceReceiptAdmin(admin.ModelAdmin):
    list_display = ("shop", "sale", "receipt_type", "invoice_no", "result_code", "simulated", "created_at")
    list_filter = ("receipt_type", "result_code", "simulated")
