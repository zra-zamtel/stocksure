from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    return JsonResponse({"status": "ok", "service": "stocksure-backend"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health", health),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.accounts.staff_urls")),
    path("api/v1/sync/", include("apps.sync.urls")),
    path("api/v1/", include("apps.configs.urls")),
    path("api/v1/", include("apps.ussd.urls")),
]
