from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChangePinView,
    LoginView,
    MeView,
    PinResetConfirmView,
    PinResetRequestView,
    RegisterView,
)

urlpatterns = [
    path("register", RegisterView.as_view(), name="register"),
    path("login", LoginView.as_view(), name="login"),
    path("refresh", TokenRefreshView.as_view(), name="refresh"),
    path("me", MeView.as_view(), name="me"),
    path("change-pin", ChangePinView.as_view(), name="change-pin"),
    path("pin-reset/request", PinResetRequestView.as_view(), name="pin-reset-request"),
    path("pin-reset/confirm", PinResetConfirmView.as_view(), name="pin-reset-confirm"),
]
