from django.urls import path

from .views import ConfirmPinResetView, RegisterOwnerView, RequestPinResetView

urlpatterns = [
    path("auth/register", RegisterOwnerView.as_view(), name="owner-register"),
    path("auth/pin-reset/request", RequestPinResetView.as_view(), name="pin-reset-request"),
    path("auth/pin-reset/confirm", ConfirmPinResetView.as_view(), name="pin-reset-confirm"),
]
