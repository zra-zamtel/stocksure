from django.http import HttpResponse
from django.utils.http import quote_etag
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import iso_now

from .models import ConfigVersion
from .validators import KINDS


class _Public(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class ConfigIndexView(_Public):
    """GET /api/v1/config: the latest published version of every file, in one call. Supports ETag, so a
    phone that already has everything gets an empty 304."""

    def get(self, request):
        configs = {}
        for kind in KINDS:
            latest = ConfigVersion.latest_published(kind)
            if latest:
                configs[kind] = latest.as_response()
        etag = quote_etag("-".join(f"{k}:{c['version']}:{c['checksum'][:12]}" for k, c in sorted(configs.items())) or "empty")
        if request.headers.get("If-None-Match") == etag:
            resp = HttpResponse(status=304)
            resp["ETag"] = etag
            return resp
        resp = Response({"serverTime": iso_now(), "configs": configs})
        resp["ETag"] = etag
        return resp


class ConfigKindView(_Public):
    """GET /api/v1/config/<kind>?have=<version>: 304 if the phone already has the latest."""

    def get(self, request, kind):
        if kind not in KINDS:
            raise NotFound(f"Unknown config '{kind}'. Use one of: {', '.join(KINDS)}.")
        latest = ConfigVersion.latest_published(kind)
        if latest is None:
            raise NotFound("Nothing has been published for this config yet.")
        have = request.query_params.get("have")
        if have and have.isdigit() and int(have) >= latest.version:
            return HttpResponse(status=304)
        return Response(latest.as_response())
