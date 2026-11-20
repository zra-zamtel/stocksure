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

    The gateway's POST is form-encoded and carries no custom headers, so the
    shared secret is accepted either from X-USSD-Secret or from the callback
    URL itself (?token=...). Africa's Talking only supports the URL form."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ussd"
    parser_classes = [FormParser, JSONParser]

    def post(self, request):
        secret = getattr(settings, "USSD_SHARED_SECRET", "")
        if not secret:
            # An unset secret used to mean "open to anyone", which let a caller
            # act as any owner's phone number. Local debug runs may stay open;
            # everything else must configure the gateway secret.
            if not settings.DEBUG:
                raise PermissionDenied("USSD gateway secret is not configured.")
        elif not hmac.compare_digest(
            request.headers.get("X-USSD-Secret") or request.query_params.get("token") or "",
            secret,
        ):
            raise PermissionDenied("Bad gateway secret.")
        phone = request.data.get("phoneNumber") or request.data.get("phone") or ""
        text = request.data.get("text", "")
        return HttpResponse(handle(phone, text), content_type="text/plain; charset=utf-8")
