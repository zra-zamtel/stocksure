from rest_framework.routers import DefaultRouter

from .views import InvoiceScanViewSet, ItemViewSet, StockTakeViewSet

router = DefaultRouter()
router.register("items", ItemViewSet, basename="item")
router.register("invoice-scans", InvoiceScanViewSet, basename="invoice-scan")
router.register("stock-takes", StockTakeViewSet, basename="stock-take")
urlpatterns = router.urls
