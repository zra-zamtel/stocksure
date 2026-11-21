from django.urls import path

from .views import RequestToPayStatusView, RequestToPayView

urlpatterns = [
    path("collections/request-to-pay", RequestToPayView.as_view(), name="request-to-pay"),
    path(
        "collections/request-to-pay/<str:request_id>",
        RequestToPayStatusView.as_view(),
        name="request-to-pay-status",
    ),
]
