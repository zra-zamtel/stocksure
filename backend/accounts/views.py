import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import DeviceSession, MagicLinkToken, Owner, PinResetCode, Staff
from .serializers import (
    DevicePinSerializer,
    MagicLinkRequestSerializer,
    MagicLinkVerifySerializer,
    OwnerLoginSerializer,
    OwnerRegistrationSerializer,
    OwnerSerializer,
    PinResetConfirmSerializer,
    PinResetRequestSerializer,
    StaffRegistrationSerializer,
    StaffSerializer,
    StaffSignInConfirmSerializer,
)

logger = logging.getLogger(__name__)

RESET_CODE_TTL = timedelta(minutes=10)
RESET_MAX_ATTEMPTS = 5
MAGIC_LINK_TTL = timedelta(minutes=15)
DEVICE_TTL = timedelta(days=30)
STAFF_LOCK_AFTER = 5
STAFF_LOCK_FOR = timedelta(minutes=15)


def error(code: str, detail: str, status_code: int) -> Response:
    return Response({"code": code, "detail": detail}, status=status_code)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_device_token(owner: Owner) -> str:
    token = secrets.token_urlsafe(32)
    DeviceSession.objects.create(
        owner=owner,
        token_hash=hash_token(token),
        expires_at=timezone.now() + DEVICE_TTL,
        last_seen_at=timezone.now(),
    )
    return token


def auth_payload(owner: Owner) -> dict:
    """The owner fields plus a bearer token for this phone."""
    return {"owner": OwnerSerializer(owner).data, "deviceToken": issue_device_token(owner)}


def bearer_token(request) -> str | None:
    header = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not header.startswith(prefix):
        return None
    token = header[len(prefix) :].strip()
    return token or None


def device_for_token(token: str) -> DeviceSession | None:
    return (
        DeviceSession.objects.select_related("owner")
        .filter(
            token_hash=hash_token(token),
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .first()
    )


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
        email = data["email"]

        same_id = Owner.objects.filter(id=data["id"]).first()
        if same_id and same_id.phone != phone:
            return error(
                "id_conflict",
                "That account ID is already used by another phone number.",
                status.HTTP_409_CONFLICT,
            )

        existing = Owner.objects.filter(phone=phone).first()
        if existing and existing.id != data["id"]:
            return error(
                "phone_taken",
                "That phone number is already registered.",
                status.HTTP_409_CONFLICT,
            )

        if Staff.objects.filter(phone=phone).exists():
            return error(
                "phone_taken",
                "That phone number belongs to a staff account.",
                status.HTTP_409_CONFLICT,
            )

        email_owner = Owner.objects.filter(email=email).first()
        if email_owner and email_owner.id != data["id"]:
            return error(
                "email_taken",
                "That email address is already registered.",
                status.HTTP_409_CONFLICT,
            )

        if existing:
            # A retry after a lost response is safe only when the phone can
            # prove it still holds the same credentials. It never updates
            # email, password or PIN: otherwise knowing an owner ID and phone
            # would be enough to take the account over.
            same_password = bool(existing.password_hash) and check_password(
                data["password"], existing.password_hash
            )
            if not same_password or existing.pin_hash != data["pinHash"]:
                return error(
                    "account_conflict",
                    "An account already exists for this ID. Sign in with email instead.",
                    status.HTTP_409_CONFLICT,
                )
            return Response(auth_payload(existing), status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                owner = Owner.objects.create(
                    id=data["id"],
                    name=data["name"],
                    phone=phone,
                    email=email,
                    password_hash=make_password(data["password"]),
                    pin_hash=data["pinHash"],
                )
        except IntegrityError:
            # Another request won the race. The phone can retry; it gets a
            # clear duplicate error rather than a server crash.
            return error(
                "phone_taken",
                "That phone number or email is already registered.",
                status.HTTP_409_CONFLICT,
            )

        return Response(auth_payload(owner), status=status.HTTP_201_CREATED)


class LoginOwnerView(APIView):
    """POST /api/v1/auth/login

    The online identity check. A successful login returns a device token; the
    phone then sets its own PIN so the next unlock works offline.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = OwnerLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        owner = Owner.objects.filter(email=data["email"]).first()
        if not owner or not owner.password_hash:
            return error(
                "invalid_credentials",
                "That email and password do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )
        if not check_password(data["password"], owner.password_hash):
            return error(
                "invalid_credentials",
                "That email and password do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )

        return Response(auth_payload(owner), status=status.HTTP_200_OK)


class RequestMagicLinkView(APIView):
    """POST /api/v1/auth/magic-link/request

    Send a single-use link to the owner's email. Unknown addresses get the same
    generic response, so the endpoint cannot be used to discover accounts.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "magic"

    def post(self, request):
        serializer = MagicLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        expires_at = timezone.now() + MAGIC_LINK_TTL
        payload = {"expiresAt": expires_at.isoformat()}

        owner = Owner.objects.filter(email=email).first()
        if not owner:
            return Response(payload, status=status.HTTP_200_OK)

        now = timezone.now()
        owner.magic_links.filter(used_at__isnull=True).update(used_at=now)

        token = secrets.token_urlsafe(32)
        MagicLinkToken.objects.create(
            owner=owner,
            token_hash=hash_token(token),
            expires_at=expires_at,
        )

        base = settings.MAGIC_LINK_BASE_URL
        separator = "&" if "?" in base else "?"
        link = f"{base}{separator}{urlencode({'token': token})}"
        send_mail(
            subject="Your StockSure sign-in link",
            message=(
                "Open this link on your phone to sign in to StockSure:\n\n"
                f"{link}\n\n"
                "The link works once and expires in 15 minutes. "
                "If you did not ask for it, you can ignore this email."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[owner.email],
            fail_silently=False,
        )

        if settings.EXPOSE_EMAIL_TOKEN:
            payload["demoToken"] = token
            payload["demoUrl"] = link

        return Response(payload, status=status.HTTP_200_OK)


class VerifyMagicLinkView(APIView):
    """POST /api/v1/auth/magic-link/verify

    A magic link is proof that the owner controls the email address. Mark it
    used, verify the email and issue a device token for this phone.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "magic"

    def post(self, request):
        serializer = MagicLinkVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        now = timezone.now()
        with transaction.atomic():
            link = (
                MagicLinkToken.objects.select_for_update()
                .select_related("owner")
                .filter(token_hash=hash_token(serializer.validated_data["token"]))
                .first()
            )
            if link is None or link.used_at is not None:
                return error(
                    "invalid_token",
                    "That sign-in link is not valid. Request a new one.",
                    status.HTTP_400_BAD_REQUEST,
                )
            if link.expires_at <= now:
                link.used_at = now
                link.save(update_fields=["used_at"])
                return error(
                    "expired_token",
                    "That sign-in link has expired. Request a new one.",
                    status.HTTP_410_GONE,
                )

            link.used_at = now
            link.save(update_fields=["used_at"])
            if link.owner.email_verified_at is None:
                link.owner.email_verified_at = now
                link.owner.save(update_fields=["email_verified_at", "updated_at"])

        return Response(auth_payload(link.owner), status=status.HTTP_200_OK)


class SetDevicePinView(APIView):
    """POST /api/v1/auth/device-pin

    After an email login on a new phone, the phone sends the salted PIN hash it
    will check offline. The device token proves this call is for that owner.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = bearer_token(request)
        if not token:
            return error("unauthorized", "Sign in again to set the phone PIN.", status.HTTP_401_UNAUTHORIZED)
        device = device_for_token(token)
        if not device:
            return error("unauthorized", "Sign in again to set the phone PIN.", status.HTTP_401_UNAUTHORIZED)

        serializer = DevicePinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        now = timezone.now()
        device.owner.pin_hash = serializer.validated_data["pinHash"]
        device.owner.save(update_fields=["pin_hash", "updated_at"])
        device.last_seen_at = now
        device.save(update_fields=["last_seen_at"])
        return Response(OwnerSerializer(device.owner).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """POST /api/v1/auth/logout

    Revoke the device token for this phone. The local PIN can still be used to
    open the app, but online calls with this token stop working.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = bearer_token(request)
        device = device_for_token(token) if token else None
        if not device:
            return error("unauthorized", "This phone is not signed in.", status.HTTP_401_UNAUTHORIZED)

        device.revoked_at = timezone.now()
        device.save(update_fields=["revoked_at"])
        return Response({"revoked": True}, status=status.HTTP_200_OK)


class RequestPinResetView(APIView):
    """POST /api/v1/auth/pin-reset/request

    A forgotten PIN can only be reset online. The code is stored as a hash and
    expires after ten minutes. Requesting another code invalidates the previous
    one, so there is a single live code at a time.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin-reset"

    def post(self, request):
        serializer = PinResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = Owner.objects.filter(phone=serializer.validated_data["phone"]).first()
        if not owner:
            # Same shape as a known number, so this endpoint cannot be used to
            # discover which phone numbers are registered.
            return Response(
                {"expiresAt": (timezone.now() + RESET_CODE_TTL).isoformat()},
                status=status.HTTP_200_OK,
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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin-reset"

    def post(self, request):
        serializer = PinResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        owner = Owner.objects.filter(phone=data["phone"]).first()
        if not owner:
            return error(
                "invalid_code",
                "That code is not correct.",
                status.HTTP_400_BAD_REQUEST,
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


class ConfirmStaffSignInView(APIView):
    """POST /api/v1/auth/staff-sign-in/confirm

    First sign-in on a phone. The PIN crosses TLS once here; the server checks a
    Django password hash. Repeated failures lock the account for 15 minutes so a
    4-digit PIN cannot be brute-forced online.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "staff-signin"

    def post(self, request):
        serializer = StaffSignInConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        staff = Staff.objects.filter(phone=data["phone"]).first()
        if not staff or not staff.pin_verifier:
            return error(
                "invalid_credentials",
                "That phone number and PIN do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )

        now = timezone.now()
        if staff.locked_until and staff.locked_until > now:
            return error(
                "too_many_attempts",
                "Too many tries. Try again later.",
                status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if not check_password(data["pin"], staff.pin_verifier):
            staff.failed_sign_ins += 1
            update_fields = ["failed_sign_ins", "updated_at"]
            if staff.failed_sign_ins >= STAFF_LOCK_AFTER:
                staff.locked_until = now + STAFF_LOCK_FOR
                staff.failed_sign_ins = 0
                update_fields.append("locked_until")
            staff.save(update_fields=update_fields)
            return error(
                "invalid_credentials",
                "That phone number and PIN do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )

        staff.failed_sign_ins = 0
        staff.locked_until = None
        if staff.first_signed_in_at is None:
            staff.first_signed_in_at = now
        staff.save(
            update_fields=[
                "failed_sign_ins",
                "locked_until",
                "first_signed_in_at",
                "updated_at",
            ]
        )

        return Response(
            {
                "staff": StaffSerializer(staff).data,
                "owner": {"name": staff.owner.name, "phone": staff.owner.phone},
            },
            status=status.HTTP_200_OK,
        )


class RegisterStaffView(APIView):
    """POST /api/v1/staff

    The owner's phone has already checked this staff PIN and hashed it. The
    server stores the same salted hash under the owner, so the staff member's
    first sign-in on a phone can be verified online. A retry with the same ID is
    safe, like owner registration.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "staff-register"

    def post(self, request):
        serializer = StaffRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        token = bearer_token(request)
        device = device_for_token(token) if token else None
        if not device:
            return error(
                "unauthorized",
                "Sign in with the owner account before adding staff.",
                status.HTTP_401_UNAUTHORIZED,
            )
        if device.owner.id != data["ownerId"]:
            return error(
                "forbidden",
                "That owner account does not match this phone.",
                status.HTTP_403_FORBIDDEN,
            )
        owner = device.owner

        phone = data["phone"]
        same_id = Staff.objects.filter(id=data["id"]).first()
        if same_id and (same_id.owner_id != owner.id or same_id.phone != phone):
            return error(
                "id_conflict",
                "That staff ID is already used by another person.",
                status.HTTP_409_CONFLICT,
            )

        if Owner.objects.filter(phone=phone).exists():
            return error(
                "phone_taken",
                "That phone number belongs to an owner.",
                status.HTTP_409_CONFLICT,
            )

        existing = Staff.objects.filter(phone=phone).first()
        if existing and existing.id != data["id"]:
            return error(
                "phone_taken",
                "That phone number already has a staff account.",
                status.HTTP_409_CONFLICT,
            )

        # A repeat of the same ID is a retry. Return the existing row without
        # letting a caller replace the staff member's PIN.
        if existing:
            return Response(StaffSerializer(existing).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                staff = Staff.objects.create(
                    id=data["id"],
                    owner=owner,
                    name=data["name"],
                    phone=phone,
                    pin_hash=data["pinHash"],
                    pin_verifier=make_password(data["pin"]),
                )
        except IntegrityError:
            return error(
                "phone_taken",
                "That phone number already has a staff account.",
                status.HTTP_409_CONFLICT,
            )

        return Response(StaffSerializer(staff).data, status=status.HTTP_201_CREATED)
