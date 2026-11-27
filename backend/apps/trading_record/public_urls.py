from django.urls import path

from .views import verify_json, verify_page

urlpatterns = [
    path("verify/<str:token>/", verify_page, name="trading-record-verify"),
    path("verify/<str:token>/json/", verify_json, name="trading-record-verify-json"),
]
