from django.urls import path

from .views import FeeQuoteView, RequestToPayStatusView, RequestToPayView

urlpatterns = [
    path("collections/quote", FeeQuoteView.as_view(), name="collections-quote"),
    path("collections/request-to-pay", RequestToPayView.as_view(), name="request-to-pay"),
    path(
        "collections/request-to-pay/<str:request_id>",
        RequestToPayStatusView.as_view(),
        name="request-to-pay-status",
    ),
]
