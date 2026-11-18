import hmac

from django.conf import settings
from django.http import HttpResponse
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.utils import normalize_phone

from .menus import handle


class UssdView(APIView):
    """Africa's Talking callback: POST phoneNumber + text (e.g. "1*2*3"). Replies in plain text, starting
    CON (continue) or END (finish). Works only on data the owner's phone has already synced."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ussd"
    parser_classes = [FormParser, JSONParser]

    def post(self, request):
        secret = getattr(settings, "USSD_SHARED_SECRET", "")
        if secret and not hmac.compare_digest(request.headers.get("X-USSD-Secret", ""), secret):
            raise PermissionDenied("Bad gateway secret.")
        phone = normalize_phone(request.data.get("phoneNumber") or request.data.get("phone") or "")
        text = request.data.get("text") or ""
        user = User.objects.filter(phone=phone, is_active=True).first()
        if user is None or user.tenant_id is None:
            body = "END This number is not registered. Create your account in the StockSure app first."
        else:
            body = handle(user, [p.strip() for p in text.split("*")] if text else [])
        return HttpResponse(body, content_type="text/plain; charset=utf-8")
