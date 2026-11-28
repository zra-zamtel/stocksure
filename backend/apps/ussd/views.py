import hmac

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.views import notify_account_change
from apps.shops.models import Membership
from apps.sync.models import Shop

from .models import UssdPin
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
        session_id = str(request.data.get("sessionId") or "")[:100]
        return HttpResponse(handle(phone, text, session_id), content_type="text/plain; charset=utf-8")


# ---- Setting USSD PINs from the app -----------------------------------------
#
# Staff sign in on the owner's connected phone and have no server session of
# their own, so the owner sets every PIN: their own and each staff member's.


class UssdPinSerializer(serializers.Serializer):
    pin = serializers.RegexField(
        r"^\d{4}$", error_messages={"invalid": "The USSD PIN must be 4 digits."}
    )
    userId = serializers.CharField(required=False, allow_blank=True)


def _pin_status(user, row):
    now = timezone.now()
    return {
        "userId": str(user.id),
        "phone": user.phone,
        "isSet": row is not None,
        "lockedUntil": row.locked_until.isoformat()
        if row and row.locked_until and row.locked_until > now
        else None,
        "updatedAt": row.updated_at.isoformat() if row else None,
        "lastUsedAt": row.last_used_at.isoformat() if row and row.last_used_at else None,
    }


def _owners_staff(owner):
    """Active staff on the owner's shops."""
    return User.objects.filter(
        memberships__shop__owner=owner,
        memberships__role=Membership.Role.ASSISTANT,
        memberships__is_active=True,
        is_active=True,
    ).distinct()


def _target(request, user_id):
    """The person whose PIN the owner is changing, or None if not theirs."""
    if not Shop.objects.filter(owner=request.user).exists():
        return None
    if not user_id or user_id == str(request.user.id):
        return request.user
    try:
        return _owners_staff(request.user).filter(id=user_id).first()
    except (ValueError, TypeError):
        return None


def _not_found():
    return Response(
        {"code": "not_found", "detail": "That person is not part of this shop."},
        status=status.HTTP_404_NOT_FOUND,
    )


class UssdPinsView(APIView):
    """GET /api/v1/ussd/pins: whether the owner and each staff member has a USSD PIN."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not Shop.objects.filter(owner=request.user).exists():
            return Response(
                {"code": "forbidden", "detail": "Only the shop owner can see USSD PINs."},
                status=status.HTTP_403_FORBIDDEN,
            )
        people = [request.user, *_owners_staff(request.user)]
        rows = {row.user_id: row for row in UssdPin.objects.filter(user__in=people)}
        return Response({"pins": [_pin_status(person, rows.get(person.id)) for person in people]})


class UssdPinView(APIView):
    """POST /api/v1/ussd/pin {pin, userId?}: set or replace a USSD PIN.
    DELETE /api/v1/ussd/pin?userId=...: turn USSD sign-in off for that person.

    Without userId the PIN is the owner's own. A new PIN clears any lock.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ussd-pin"

    def post(self, request):
        serializer = UssdPinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = _target(request, serializer.validated_data.get("userId"))
        if target is None:
            return _not_found()
        row, created = UssdPin.objects.update_or_create(
            user=target,
            defaults={
                "pin_hash": make_password(serializer.validated_data["pin"]),
                "failed_attempts": 0,
                "locked_until": None,
                "set_by": request.user,
            },
        )
        own = target.id == request.user.id
        verb = "set" if created else "changed"
        notify_account_change(
            request.user,
            f"your USSD PIN was {verb}" if own else f"a staff USSD PIN was {verb}",
            (
                f"The USSD PIN for {'your account' if own else target.full_name or 'a staff member'} "
                f"({target.phone}) was {verb}. It is used to sign in when dialling StockSure "
                "from a basic phone."
            ),
        )
        return Response(_pin_status(target, row), status=status.HTTP_200_OK)

    def delete(self, request):
        target = _target(request, request.query_params.get("userId"))
        if target is None:
            return _not_found()
        UssdPin.objects.filter(user=target).delete()
        return Response(_pin_status(target, None), status=status.HTTP_200_OK)
