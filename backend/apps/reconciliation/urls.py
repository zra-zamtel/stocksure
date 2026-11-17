from rest_framework.routers import DefaultRouter

from .views import DailyCloseViewSet

router = DefaultRouter()
router.register("daily-closes", DailyCloseViewSet, basename="daily-close")
urlpatterns = router.urls
