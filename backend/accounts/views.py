import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Owner, PinResetCode
from .serializers import (
    OwnerRegistrationSerializer,
    OwnerSerializer,
    PinResetConfirmSerializer,
    PinResetRequestSerializer,
)

logger = logging.getLogger(__name__)

RESET_CODE_TTL = timedelta(minutes=10)
RESET_MAX_ATTEMPTS = 5


def error(code: str, detail: str, status_code: int) -> Response:
    return Response({"code": code, "detail": detail}, status=status_code)


class RegisterOwnerView(APIView):
    """POST /api/v1/auth/register

    This is the one online moment in account creation. The phone sends an ID it
    generated plus a salted PIN hash. If the response is lost and the phone
    retries with the same ID and phone, the server returns the existing owner
    instead of creating a second account.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OwnerRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        phone = data["phone"]

        same_id = Owner.objects.filter(id=data["id"]).first()
        if same_id and same_id.phone != phone:
            return error(
                "id_conflict",
                "That account ID is already used by another phone number.",
                status.HTTP_409_CONFLICT,
            )

        existing = Owner.objects.filter(phone=phone).first()
        if existing:
            if existing.id != data["id"]:
                return error(
                    "phone_taken",
                    "That phone number is already registered.",
                    status.HTTP_409_CONFLICT,
                )

            # A retry after a lost response may still correct the name or the
            # PIN hash while the owner has not signed in on this phone yet.
            changed = []
            if existing.name != data["name"]:
                existing.name = data["name"]
                changed.append("name")
            if existing.pin_hash != data["pinHash"]:
                existing.pin_hash = data["pinHash"]
                changed.append("pin_hash")
            if changed:
                existing.save(update_fields=[*changed, "updated_at"])
            return Response(OwnerSerializer(existing).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                owner = Owner.objects.create(
                    id=data["id"],
                    name=data["name"],
                    phone=phone,
                    pin_hash=data["pinHash"],
                )
        except IntegrityError:
            # Another request won the race. The phone can retry; it gets a
            # clear duplicate error rather than a server crash.
            return error(
                "phone_taken",
                "That phone number is already registered.",
                status.HTTP_409_CONFLICT,
            )

        return Response(OwnerSerializer(owner).data, status=status.HTTP_201_CREATED)


class RequestPinResetView(APIView):
    """POST /api/v1/auth/pin-reset/request

    A forgotten PIN can only be reset online. The code is stored as a hash and
    expires after ten minutes. Requesting another code invalidates the previous
    one, so there is a single live code at a time.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PinResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = Owner.objects.filter(phone=serializer.validated_data["phone"]).first()
        if not owner:
            return error(
                "phone_not_found",
                "That phone number is not registered.",
                status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()
        owner.reset_codes.filter(used_at__isnull=True).update(used_at=now)

        code = f"{secrets.randbelow(900000) + 100000}"
        reset = PinResetCode.objects.create(
            owner=owner,
            code_hash=make_password(code),
            expires_at=now + RESET_CODE_TTL,
        )

        if settings.DEBUG:
            logger.info("PIN reset code for %s: %s", owner.phone, code)

        payload = {"expiresAt": reset.expires_at.isoformat()}
        if settings.EXPOSE_RESET_CODE:
            # Prototype only: a real deployment sends the code by SMS and never
            # returns it to the client.
            payload["demoCode"] = code
        return Response(payload, status=status.HTTP_200_OK)


class ConfirmPinResetView(APIView):
    """POST /api/v1/auth/pin-reset/confirm

    The phone sends the code plus a freshly salted PIN hash. On success the
    server replaces the owner's hash, and the phone replaces its local copy with
    the same value so the next offline sign-in works.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PinResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        owner = Owner.objects.filter(phone=data["phone"]).first()
        if not owner:
            return error(
                "phone_not_found",
                "That phone number is not registered.",
                status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()
        with transaction.atomic():
            reset = (
                PinResetCode.objects.select_for_update()
                .filter(owner=owner, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if reset is None:
                return error(
                    "invalid_code",
                    "Request a new reset code.",
                    status.HTTP_400_BAD_REQUEST,
                )

            if reset.expires_at <= now:
                reset.used_at = now
                reset.save(update_fields=["used_at"])
                return error(
                    "expired_code",
                    "That code has expired. Request a new one.",
                    status.HTTP_410_GONE,
                )

            if reset.attempts >= RESET_MAX_ATTEMPTS:
                return error(
                    "too_many_attempts",
                    "Too many tries. Request a new code.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                )

            if not check_password(data["code"], reset.code_hash):
                reset.attempts += 1
                reset.save(update_fields=["attempts"])
                if reset.attempts >= RESET_MAX_ATTEMPTS:
                    return error(
                        "too_many_attempts",
                        "Too many tries. Request a new code.",
                        status.HTTP_429_TOO_MANY_REQUESTS,
                    )
                return error(
                    "invalid_code",
                    "That code is not correct.",
                    status.HTTP_400_BAD_REQUEST,
                )

            reset.used_at = now
            reset.save(update_fields=["used_at"])
            owner.pin_hash = data["pinHash"]
            owner.save(update_fields=["pin_hash", "updated_at"])

        return Response(OwnerSerializer(owner).data, status=status.HTTP_200_OK)
