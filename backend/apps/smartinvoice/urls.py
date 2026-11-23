from django.urls import path

from .views import SmartInvoiceConnectView, SmartInvoiceSaleView, SmartInvoiceStatusView

urlpatterns = [
    path("smart-invoice/status", SmartInvoiceStatusView.as_view(), name="smart-invoice-status"),
    path("smart-invoice/connect", SmartInvoiceConnectView.as_view(), name="smart-invoice-connect"),
    path("smart-invoice/sales/<str:sale_id>", SmartInvoiceSaleView.as_view(), name="smart-invoice-sale"),
]
