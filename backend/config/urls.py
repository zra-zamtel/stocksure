from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    return JsonResponse({"status": "ok", "service": "stocksure"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    path("api/auth/", include("apps.accounts.urls")),
    # The mobile app's existing paths. Keep them until the app moves to the
    # domain API prefixes in the sync step.
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.sync.urls")),
    path("api/v1/", include("apps.configs.urls")),
    path("api/v1/", include("apps.collections.urls")),
    path("api/", include("apps.shops.urls")),
    path("api/", include("apps.inventory.urls")),
    path("api/", include("apps.sales.urls")),
    path("api/", include("apps.reconciliation.urls")),
    path("api/", include("apps.ledger.urls")),
    path("api/", include("apps.tax.urls")),
    path("api/", include("apps.taxpot.urls")),
    path("api/", include("apps.taxmate.urls")),
    path("api/", include("apps.notifications.urls")),
    path("api/", include("apps.ussd.urls")),
    path("api/", include("apps.analytics.urls")),
    *static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT),
]
