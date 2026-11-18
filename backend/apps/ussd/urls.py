from django.urls import path

from .views import UssdView

urlpatterns = [path("ussd", UssdView.as_view(), name="ussd")]
