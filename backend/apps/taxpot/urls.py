from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import SavingsTargetViewSet, TransactionViewSet, WalletView

router = DefaultRouter()
router.register("taxpot/targets", SavingsTargetViewSet, basename="taxpot-target")
router.register("taxpot/transactions", TransactionViewSet, basename="taxpot-transaction")
urlpatterns = [path("taxpot/wallet/", WalletView.as_view(), name="taxpot-wallet")] + router.urls
