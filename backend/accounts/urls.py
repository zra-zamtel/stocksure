from django.urls import path

from .views import (
    ConfirmPinResetView,
    ConfirmStaffSignInView,
    LoginOwnerView,
    LogoutView,
    RegisterOwnerView,
    RegisterStaffView,
    RequestMagicLinkView,
    ResetStaffPinView,
    RequestPinResetView,
    SetDevicePinView,
    VerifyMagicLinkView,
)

urlpatterns = [
    path("auth/register", RegisterOwnerView.as_view(), name="owner-register"),
    path("auth/login", LoginOwnerView.as_view(), name="owner-login"),
    path("auth/logout", LogoutView.as_view(), name="owner-logout"),
    path("auth/magic-link/request", RequestMagicLinkView.as_view(), name="magic-link-request"),
    path("auth/magic-link/verify", VerifyMagicLinkView.as_view(), name="magic-link-verify"),
    path("auth/device-pin", SetDevicePinView.as_view(), name="device-pin"),
    path("auth/pin-reset/request", RequestPinResetView.as_view(), name="pin-reset-request"),
    path("auth/pin-reset/confirm", ConfirmPinResetView.as_view(), name="pin-reset-confirm"),
    path("staff", RegisterStaffView.as_view(), name="staff-register"),
    path(
        "staff/<str:staff_id>/pin-reset",
        ResetStaffPinView.as_view(),
        name="staff-pin-reset",
    ),
    path(
        "auth/staff-sign-in/confirm",
        ConfirmStaffSignInView.as_view(),
        name="staff-sign-in-confirm",
    ),
]
