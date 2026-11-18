from django.urls import path

from .views import USSDView

urlpatterns = [path("ussd/", USSDView.as_view(), name="ussd")]
