from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChangeEmailView,
    ConfirmPasswordResetView,
    ConfirmPinResetView,
    ConfirmStaffSignInView,
    LoginView,
    LogoutView,
    MeView,
    RegisterOwnerView,
    RegisterStaffView,
    RequestEmailCodeView,
    RequestPasswordResetView,
    RequestPinResetView,
    ResetStaffPinView,
    SetDevicePinView,
    VerifyEmailCodeView,
)

# Both spellings are registered because the mobile app uses no trailing slash
# and the domain clients use one. APPEND_SLASH cannot help POST bodies.
urlpatterns = [
    path("register", RegisterOwnerView.as_view(), name="owner-register"),
    path("register/", RegisterOwnerView.as_view(), name="owner-register-slash"),
    path("login", LoginView.as_view(), name="owner-login"),
    path("login/", LoginView.as_view(), name="owner-login-slash"),
    path("logout", LogoutView.as_view(), name="owner-logout"),
    path("logout/", LogoutView.as_view(), name="owner-logout-slash"),
    path("refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("refresh/", TokenRefreshView.as_view(), name="token-refresh-slash"),
    path("me", MeView.as_view(), name="me"),
    path("me/", MeView.as_view(), name="me-slash"),
    path("email-code/request", RequestEmailCodeView.as_view(), name="email-code-request"),
    path("email-code/request/", RequestEmailCodeView.as_view(), name="email-code-request-slash"),
    path("email-code/verify", VerifyEmailCodeView.as_view(), name="email-code-verify"),
    path("email-code/verify/", VerifyEmailCodeView.as_view(), name="email-code-verify-slash"),
    path("email-change", ChangeEmailView.as_view(), name="email-change"),
    path("email-change/", ChangeEmailView.as_view(), name="email-change-slash"),
    path("password-reset/request", RequestPasswordResetView.as_view(), name="password-reset-request"),
    path("password-reset/request/", RequestPasswordResetView.as_view(), name="password-reset-request-slash"),
    path("password-reset/confirm", ConfirmPasswordResetView.as_view(), name="password-reset-confirm"),
    path("password-reset/confirm/", ConfirmPasswordResetView.as_view(), name="password-reset-confirm-slash"),
    path("device-pin", SetDevicePinView.as_view(), name="device-pin"),
    path("device-pin/", SetDevicePinView.as_view(), name="device-pin-slash"),
    path("pin-reset/request", RequestPinResetView.as_view(), name="pin-reset-request"),
    path("pin-reset/request/", RequestPinResetView.as_view(), name="pin-reset-request-slash"),
    path("pin-reset/confirm", ConfirmPinResetView.as_view(), name="pin-reset-confirm"),
    path("pin-reset/confirm/", ConfirmPinResetView.as_view(), name="pin-reset-confirm-slash"),
    path("staff", RegisterStaffView.as_view(), name="staff-register"),
    path("staff/", RegisterStaffView.as_view(), name="staff-register-slash"),
    path(
        "staff/<str:staff_id>/pin-reset",
        ResetStaffPinView.as_view(),
        name="staff-pin-reset",
    ),
    path(
        "staff/<str:staff_id>/pin-reset/",
        ResetStaffPinView.as_view(),
        name="staff-pin-reset-slash",
    ),
    path(
        "staff-sign-in/confirm",
        ConfirmStaffSignInView.as_view(),
        name="staff-sign-in-confirm",
    ),
    path(
        "staff-sign-in/confirm/",
        ConfirmStaffSignInView.as_view(),
        name="staff-sign-in-confirm-slash",
    ),
]
