import hmac

from django.conf import settings
from django.http import HttpResponse
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .services import handle


class USSDView(APIView):
    """POST phoneNumber + text. Replies with plain text starting CON (continue) or END (finish).
    In production set USSD_SHARED_SECRET and restrict to the operator's gateway."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ussd"
    parser_classes = [FormParser, JSONParser]

    def post(self, request):
        secret = getattr(settings, "USSD_SHARED_SECRET", "")
        if secret and not hmac.compare_digest(request.headers.get("X-USSD-Secret", ""), secret):
            raise PermissionDenied("Bad gateway secret.")
        phone = request.data.get("phoneNumber") or request.data.get("phone") or ""
        text = request.data.get("text", "")
        return HttpResponse(handle(phone, text), content_type="text/plain; charset=utf-8")
