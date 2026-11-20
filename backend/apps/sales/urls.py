from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import MobilePaymentViewSet, SaleViewSet, ZamtelWebhookView

router = DefaultRouter()
router.register("sales", SaleViewSet, basename="sale")
router.register("payments", MobilePaymentViewSet, basename="payment")
urlpatterns = router.urls + [
    path("webhooks/zamtel/", ZamtelWebhookView.as_view(), name="zamtel-webhook"),
]
