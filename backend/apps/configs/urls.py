from django.urls import path

from .views import ConfigIndexView, ConfigKindView

urlpatterns = [
    path("config", ConfigIndexView.as_view(), name="config"),
    path("config/<str:kind>", ConfigKindView.as_view(), name="config-kind"),
]
