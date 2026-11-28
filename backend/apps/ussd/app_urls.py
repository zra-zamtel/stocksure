"""App-facing USSD routes, mounted under /api/v1/ next to the other phone APIs."""
from django.urls import path

from .views import UssdPinsView, UssdPinView

urlpatterns = [
    path("ussd/pins", UssdPinsView.as_view(), name="ussd-pins"),
    path("ussd/pin", UssdPinView.as_view(), name="ussd-pin"),
]
