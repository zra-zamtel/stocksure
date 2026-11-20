from rest_framework.routers import DefaultRouter

from .views import TaxEstimateViewSet, TaxRuleSetViewSet

router = DefaultRouter()
router.register("tax/rules", TaxRuleSetViewSet, basename="tax-rule")
router.register("tax/estimates", TaxEstimateViewSet, basename="tax-estimate")
urlpatterns = router.urls
