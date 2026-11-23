import hashlib
import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken, TokenError

from apps.shops.models import Membership, Shop
from apps.sync.models import Shop as SyncShop

from .emails import send_branded
from .models import EmailCode, PinResetCode, StaffProfile, User
from .serializers import (
    DevicePinSerializer,
    EmailCodeRequestSerializer,
    EmailCodeVerifySerializer,
    LoginSerializer,
    MeSerializer,
    OwnerRegistrationSerializer,
    OwnerSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PinResetConfirmSerializer,
    PinResetRequestSerializer,
    StaffPinResetSerializer,
    StaffRegistrationSerializer,
    StaffSerializer,
    StaffSignInConfirmSerializer,
)

logger = logging.getLogger(__name__)

RESET_CODE_TTL = timedelta(minutes=10)
RESET_MAX_ATTEMPTS = 5
EMAIL_CODE_TTL = timedelta(minutes=10)
EMAIL_CODE_MAX_ATTEMPTS = 5
REGISTRATION_RETRY_WINDOW = timedelta(minutes=10)
STAFF_LOCK_AFTER = 5
STAFF_LOCK_FOR = timedelta(minutes=15)


def error(code: str, detail: str, status_code: int) -> Response:
    return Response({"code": code, "detail": detail}, status=status_code)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def auth_payload(user: User) -> dict:
    """JWT tokens plus the owner shape the mobile app already reads.

    ``deviceToken`` is kept as an alias for the access token so the app's
    existing online calls continue to work while it moves to refresh/revoke.
    """
    refresh = RefreshToken.for_user(user)
    access = str(refresh.access_token)
    return {
        "access": access,
        "refresh": str(refresh),
        "deviceToken": access,
        "user": MeSerializer(user).data,
        "owner": OwnerSerializer(user).data,
    }


def issue_email_code(user: User, purpose: str) -> tuple[EmailCode, str]:
    """Create a 6-digit code, retiring earlier live codes of the same purpose."""
    now = timezone.now()
    user.email_codes.filter(purpose=purpose, used_at__isnull=True).update(used_at=now)
    code = f"{secrets.randbelow(900000) + 100000}"
    row = EmailCode.objects.create(
        user=user,
        purpose=purpose,
        code_hash=make_password(code),
        expires_at=now + EMAIL_CODE_TTL,
    )
    return row, code


def send_email_code(user: User, code: str, purpose: str) -> None:
    if purpose == EmailCode.Purpose.PASSWORD_RESET:
        subject = "Your StockSure password reset code"
        heading = "Reset your password"
        lead = "Enter this code in the StockSure app to set a new password:"
    else:
        subject = "Your StockSure confirmation code"
        heading = "Confirm your email"
        lead = "Enter this code in the StockSure app to confirm your email address:"
    send_branded(
        to=user.email,
        subject=subject,
        heading=heading,
        paragraphs=[f"Hello {user.full_name or 'there'},", lead],
        code=code,
        note=(
            f"This code is for the account {user.phone}. It works once and expires in "
            "10 minutes. If you did not ask for it, ignore this email. Never share this code."
        ),
    )


def notify_account_change(user: User, subject: str, what: str) -> None:
    """Tell the owner by email that something important changed on the account.

    Only a confirmed address is used, and a mail failure never undoes the change.
    """
    if not user.email or user.email_verified_at is None:
        return
    try:
        send_branded(
            to=user.email,
            subject=f"StockSure: {subject}",
            heading=subject[:1].upper() + subject[1:],
            paragraphs=[
                f"Hello {user.full_name or 'there'},",
                what,
                f"When: {timezone.now():%d %b %Y, %H:%M} UTC",
            ],
            note=(
                "If this was you, there is nothing to do. If it was not, change your "
                "password in the StockSure app straight away."
            ),
        )
    except Exception as exc:  # noqa: BLE001 - a notice must never block the change
        logger.warning("Could not send the account notice to %s: %s", user.id, exc)


def check_email_code(user: User | None, purpose: str, code: str) -> Response | None:
    """Use up the user's live code if ``code`` matches it; otherwise an error.

    Must run inside a transaction. Returns None on success.
    """
    if user is None:
        return error("invalid_code", "That code is not correct.", status.HTTP_400_BAD_REQUEST)
    now = timezone.now()
    row = (
        EmailCode.objects.select_for_update()
        .filter(user=user, purpose=purpose, used_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    if row is None:
        return error("invalid_code", "Request a new code.", status.HTTP_400_BAD_REQUEST)
    if row.expires_at <= now:
        row.used_at = now
        row.save(update_fields=["used_at"])
        return error("expired_code", "That code has expired. Request a new one.", status.HTTP_410_GONE)
    if row.attempts >= EMAIL_CODE_MAX_ATTEMPTS:
        return error(
            "too_many_attempts", "Too many tries. Request a new code.", status.HTTP_429_TOO_MANY_REQUESTS
        )
    if not check_password(code, row.code_hash):
        row.attempts += 1
        row.save(update_fields=["attempts"])
        if row.attempts >= EMAIL_CODE_MAX_ATTEMPTS:
            return error(
                "too_many_attempts", "Too many tries. Request a new code.", status.HTTP_429_TOO_MANY_REQUESTS
            )
        return error("invalid_code", "That code is not correct.", status.HTTP_400_BAD_REQUEST)
    row.used_at = now
    row.save(update_fields=["used_at"])
    return None


def send_verify_code(user: User, payload: dict) -> None:
    """Email a confirmation code and record in ``payload`` whether it went out."""
    payload["verificationSent"] = False
    try:
        _, code = issue_email_code(user, EmailCode.Purpose.VERIFY)
        send_email_code(user, code, EmailCode.Purpose.VERIFY)
        payload["verificationSent"] = True
        if settings.EXPOSE_EMAIL_TOKEN:
            payload["demoCode"] = code
    except Exception as exc:  # noqa: BLE001 - report it; the owner can resend
        logger.warning("Could not send the confirmation code to %s: %s", user.id, exc)


def owner_shop(user: User, shop_id=None) -> Membership | None:
    """The requester's owner membership, optionally narrowed by X-Shop-ID."""
    memberships = Membership.objects.select_related("shop").filter(
        user=user, role=Membership.Role.OWNER, is_active=True, shop__is_active=True
    )
    if shop_id:
        try:
            return memberships.filter(shop_id=shop_id).first()
        except (ValueError, TypeError):
            return None
    return memberships.first()


class RegisterOwnerView(APIView):
    """POST /api/auth/register

    Registration is the one online moment in account creation. The phone sends
    an id it generated; retrying with the same id and phone returns the existing
    account instead of creating a second one. The PIN hash is validated and
    discarded: the phone checks the PIN offline.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = OwnerRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        phone = data["phone"]
        email = data["email"]
        client_id = data.get("id") or None

        same_client = User.objects.filter(client_id=client_id).first() if client_id else None
        if same_client and same_client.phone != phone:
            return error(
                "id_conflict",
                "That account ID is already used by another phone number.",
                status.HTTP_409_CONFLICT,
            )

        existing = User.objects.filter(phone=phone).first()
        if existing and (same_client is None or existing.id != same_client.id):
            return error(
                "phone_taken",
                "That phone number is already registered.",
                status.HTTP_409_CONFLICT,
            )
        if User.objects.filter(phone=phone, staff_profile__isnull=False).exists():
            return error(
                "phone_taken",
                "That phone number belongs to a staff account.",
                status.HTTP_409_CONFLICT,
            )

        # Only a verified address is reserved. An unverified claim is
        # provisional: otherwise anyone could squat an inbox address forever
        # and the real owner could never register.
        email_owner = User.objects.filter(email=email).first()
        if (
            email_owner
            and email_owner.email_verified_at is not None
            and (existing is None or email_owner.id != existing.id)
        ):
            return error(
                "email_taken",
                "That email address is already registered.",
                status.HTTP_409_CONFLICT,
            )

        if existing:
            # A retry after a lost response is safe only when the phone can
            # prove it still holds the same password. Credentials are never
            # updated here: otherwise knowing an id and phone would be enough
            # to take the account over.
            same_password = existing.has_usable_password() and existing.check_password(
                data["password"]
            )
            if not same_password:
                return error(
                    "account_conflict",
                    "An account already exists for this ID. Sign in with email instead.",
                    status.HTTP_409_CONFLICT,
                )
            if existing.date_joined < timezone.now() - REGISTRATION_RETRY_WINDOW:
                return error(
                    "account_conflict",
                    "This registration is too old to retry. Sign in with email instead.",
                    status.HTTP_409_CONFLICT,
                )
            return Response(auth_payload(existing), status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                if email_owner and email_owner.id != (existing.id if existing else None):
                    # Replace the stale provisional claim in the same
                    # transaction as the new owner, so a failed create never
                    # removes the old row's email.
                    email_owner.email = ""
                    email_owner.save(update_fields=["email"])
                user = User.objects.create_user(
                    phone=phone,
                    password=data["password"],
                    full_name=data["name"],
                    email=email,
                    client_id=client_id,
                )
                # Every owner gets an owner Membership, which the domain API
                # and staff registration both require. The mobile app creates
                # its local shop during onboarding; if it did not send a name
                # yet, the placeholder is replaced when the shop syncs.
                shop = Shop.objects.create(
                    owner=user,
                    name=data.get("shop_name") or f"{data['name']}'s shop",
                    town=data.get("town", ""),
                    mode=data.get("mode", Shop.Mode.LITE),
                )
                Membership.objects.create(
                    user=user, shop=shop, role=Membership.Role.OWNER
                )
                # The phone's real shop arrives through the sync endpoint and
                # replaces this empty placeholder. It exists so staff and USSD
                # have a shop before the first sync.
                now = timezone.now()
                SyncShop.objects.create(
                    id=f"shop_{uuid.uuid4().hex}",
                    owner=user,
                    name=shop.name,
                    type="other",
                    town=shop.town,
                    currency="ZMW",
                    language=user.language,
                    onboarding_completed=False,
                    created_at=now,
                    updated_at=now,
                )
        except IntegrityError:
            return error(
                "phone_taken",
                "That phone number or email is already registered.",
                status.HTTP_409_CONFLICT,
            )

        # Confirm the address while the registration is fresh, so a real
        # owner's claim becomes protected within minutes. A mail outage must not
        # lose the account that was just created; the owner can resend the code.
        payload = auth_payload(user)
        send_verify_code(user, payload)

        return Response(payload, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    """POST /api/auth/login

    Email + password for the app, or phone + password for the domain clients.
    Email sign-in stays blocked until an emailed code proves the inbox; phone
    sign-in has no email step.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if data.get("email"):
            user = User.objects.filter(email=data["email"]).first()
            check_verified = True
        else:
            user = User.objects.filter(phone=data["phone"]).first()
            check_verified = False

        if (
            user is None
            or not user.has_usable_password()
            or not user.check_password(data["password"])
        ):
            return error(
                "invalid_credentials",
                "That email/phone and password do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )
        if check_verified and user.email_verified_at is None:
            # A password proves the secret, not that the owner controls the
            # inbox. Only reveal this after the password is correct, and email
            # a fresh code straight away: entering it signs the owner in.
            payload = {
                "code": "email_unverified",
                "detail": "We emailed you a 6-digit code. Enter it to confirm your email.",
            }
            send_verify_code(user, payload)
            return Response(payload, status=status.HTTP_403_FORBIDDEN)

        return Response(auth_payload(user), status=status.HTTP_200_OK)


class LogoutView(APIView):
    """POST /api/auth/logout — blacklist the refresh token for this device."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "logout"

    def post(self, request):
        refresh = request.data.get("refresh")
        if not refresh:
            return error("invalid_token", "Send the refresh token to sign out.", status.HTTP_400_BAD_REQUEST)
        try:
            RefreshToken(refresh).blacklist()
        except TokenError:
            return error("invalid_token", "That refresh token is not valid.", status.HTTP_400_BAD_REQUEST)
        return Response({"revoked": True}, status=status.HTTP_200_OK)


class RequestEmailCodeView(APIView):
    """POST /api/auth/email-code/request

    Send a fresh 6-digit code to confirm an unverified email. Unknown or already
    confirmed addresses get the same generic response, so the endpoint cannot
    be used to discover accounts.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email-code"

    def post(self, request):
        serializer = EmailCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payload = {"expiresAt": (timezone.now() + EMAIL_CODE_TTL).isoformat()}

        user = User.objects.filter(email=data["email"]).first()
        # The phone number proves this is the person who registered the claim;
        # an inbox owner who never registered this account cannot know it.
        if user is None or user.email_verified_at is not None or data.get("phone") != user.phone:
            return Response(payload, status=status.HTTP_200_OK)

        row, code = issue_email_code(user, EmailCode.Purpose.VERIFY)
        send_email_code(user, code, EmailCode.Purpose.VERIFY)
        payload["expiresAt"] = row.expires_at.isoformat()
        if settings.EXPOSE_EMAIL_TOKEN:
            payload["demoCode"] = code
        return Response(payload, status=status.HTTP_200_OK)


class VerifyEmailCodeView(APIView):
    """POST /api/auth/email-code/verify

    The code proves the owner controls the email address. Confirm it and issue
    JWT tokens for this phone.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email-code"

    def post(self, request):
        serializer = EmailCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email=data["email"]).first()
        with transaction.atomic():
            refused = check_email_code(user, EmailCode.Purpose.VERIFY, data["code"])
            if refused:
                return refused
            if user.email_verified_at is None:
                user.email_verified_at = timezone.now()
                user.save(update_fields=["email_verified_at"])

        return Response(auth_payload(user), status=status.HTTP_200_OK)


class RequestPasswordResetView(APIView):
    """POST /api/auth/password-reset/request

    Email a 6-digit code to a confirmed address. Unknown and unconfirmed
    addresses get the same response without sending anything.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email-code"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = {"expiresAt": (timezone.now() + EMAIL_CODE_TTL).isoformat()}

        user = User.objects.filter(email=serializer.validated_data["email"]).first()
        if user is None or user.email_verified_at is None:
            return Response(payload, status=status.HTTP_200_OK)

        row, code = issue_email_code(user, EmailCode.Purpose.PASSWORD_RESET)
        send_email_code(user, code, EmailCode.Purpose.PASSWORD_RESET)
        payload["expiresAt"] = row.expires_at.isoformat()
        if settings.EXPOSE_EMAIL_TOKEN:
            payload["demoCode"] = code
        return Response(payload, status=status.HTTP_200_OK)


class ConfirmPasswordResetView(APIView):
    """POST /api/auth/password-reset/confirm

    Check the emailed code, set the new password and sign this phone in. The
    owner is told by email that the password changed.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email-code"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email=data["email"]).first()
        with transaction.atomic():
            refused = check_email_code(user, EmailCode.Purpose.PASSWORD_RESET, data["code"])
            if refused:
                return refused
            user.set_password(data["password"])
            user.save(update_fields=["password"])

        notify_account_change(user, "your password was changed", "The password for your StockSure account was changed.")
        return Response(auth_payload(user), status=status.HTTP_200_OK)


class SetDevicePinView(APIView):
    """POST /api/auth/device-pin

    The phone sends the salted PIN hash it checks offline. The server does not
    keep it; this call only proves the fresh JWT works before the app switches
    to the offline PIN.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "device-pin"

    def post(self, request):
        serializer = DevicePinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(OwnerSerializer(request.user).data, status=status.HTTP_200_OK)


class RequestPinResetView(APIView):
    """POST /api/auth/pin-reset/request

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
        user = User.objects.filter(phone=serializer.validated_data["phone"]).first()
        if not user:
            # Same shape as a known number, so this endpoint cannot be used to
            # discover which phone numbers are registered.
            return Response(
                {"expiresAt": (timezone.now() + RESET_CODE_TTL).isoformat()},
                status=status.HTTP_200_OK,
            )

        now = timezone.now()
        user.reset_codes.filter(used_at__isnull=True).update(used_at=now)

        code = f"{secrets.randbelow(900000) + 100000}"
        reset = PinResetCode.objects.create(
            user=user,
            code_hash=make_password(code),
            expires_at=now + RESET_CODE_TTL,
        )

        if settings.DEBUG:
            logger.info("PIN reset code for %s: %s", user.phone, code)

        payload = {"expiresAt": reset.expires_at.isoformat()}
        if settings.EXPOSE_RESET_CODE:
            # Prototype only: a real deployment sends the code by SMS and never
            # returns it to the client.
            payload["demoCode"] = code
        return Response(payload, status=status.HTTP_200_OK)


class ConfirmPinResetView(APIView):
    """POST /api/auth/pin-reset/confirm

    The phone sends the code plus a freshly salted PIN hash. On success the
    server marks the code used; the hash itself is not stored because the PIN is
    checked on the phone.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin-reset"

    def post(self, request):
        serializer = PinResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(phone=data["phone"]).first()
        if not user:
            return error("invalid_code", "That code is not correct.", status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        with transaction.atomic():
            reset = (
                PinResetCode.objects.select_for_update()
                .filter(user=user, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if reset is None:
                return error("invalid_code", "Request a new reset code.", status.HTTP_400_BAD_REQUEST)

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
                return error("invalid_code", "That code is not correct.", status.HTTP_400_BAD_REQUEST)

            reset.used_at = now
            reset.save(update_fields=["used_at"])

        notify_account_change(
            user, "your app PIN was reset", "The PIN for the StockSure app on your phone was reset."
        )
        return Response(OwnerSerializer(user).data, status=status.HTTP_200_OK)


class RegisterStaffView(APIView):
    """POST /api/auth/staff

    The owner's phone adds a staff member. The phone has already checked this
    PIN and hashed it; the server stores a Django verifier for the first sign-in
    and never the phone's offline hash. A retry with the same client id is safe.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "staff-register"

    def post(self, request):
        serializer = StaffRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        membership = owner_shop(
            request.user,
            request.headers.get("X-Shop-ID") or request.query_params.get("shop"),
        )
        if membership is None:
            return error(
                "forbidden",
                "Sign in with the owner account before adding staff.",
                status.HTTP_403_FORBIDDEN,
            )
        if data.get("ownerId") and data["ownerId"] != str(request.user.id):
            return error(
                "forbidden",
                "That owner account does not match this phone.",
                status.HTTP_403_FORBIDDEN,
            )

        phone = data["phone"]
        client_id = data.get("id") or None

        same_client = (
            StaffProfile.objects.select_related("user").filter(client_id=client_id).first()
            if client_id
            else None
        )
        if same_client:
            if same_client.user.phone != phone:
                return error(
                    "id_conflict",
                    "That staff ID is already used by another person.",
                    status.HTTP_409_CONFLICT,
                )
            if not Membership.objects.filter(
                user=same_client.user,
                shop=membership.shop,
                role=Membership.Role.ASSISTANT,
                is_active=True,
            ).exists():
                return error(
                    "id_conflict",
                    "That staff ID is already used by another shop.",
                    status.HTTP_409_CONFLICT,
                )
            # A retry: return the existing row without replacing the PIN.
            return Response(StaffSerializer(same_client.user).data, status=status.HTTP_200_OK)

        if User.objects.filter(phone=phone).exists():
            return error(
                "phone_taken",
                "That phone number already has an account.",
                status.HTTP_409_CONFLICT,
            )

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    phone=phone, password=None, full_name=data["name"]
                )
                Membership.objects.create(
                    user=user, shop=membership.shop, role=Membership.Role.ASSISTANT
                )
                StaffProfile.objects.create(
                    user=user,
                    client_id=client_id,
                    pin_verifier=make_password(data["pin"]),
                )
        except IntegrityError:
            return error(
                "phone_taken",
                "That phone number already has a staff account.",
                status.HTTP_409_CONFLICT,
            )

        notify_account_change(
            request.user,
            "a staff member was added",
            f"{user.full_name} ({user.phone}) was added as staff to {membership.shop.name}.",
        )
        return Response(StaffSerializer(user).data, status=status.HTTP_201_CREATED)


class ResetStaffPinView(APIView):
    """POST /api/auth/staff/<staffId>/pin-reset

    Only the owner can replace a staff member's PIN. The staff row must belong
    to one of the requester's shops. A reset clears any lock left by failed
    sign-ins.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "staff-pin-reset"

    def post(self, request, staff_id: str):
        try:
            staff = User.objects.filter(id=staff_id, staff_profile__isnull=False).first()
        except (ValueError, TypeError):
            staff = None
        if staff is None or not Membership.objects.filter(
            user=staff, role=Membership.Role.ASSISTANT, shop__owner=request.user, is_active=True
        ).exists():
            # A staff member from another shop is reported as missing, so the
            # endpoint cannot be used to discover other owners' staff IDs.
            return error(
                "staff_not_found",
                "That staff member is not part of this shop.",
                status.HTTP_404_NOT_FOUND,
            )

        serializer = StaffPinResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        profile = staff.staff_profile
        profile.pin_verifier = make_password(serializer.validated_data["pin"])
        profile.failed_sign_ins = 0
        profile.locked_until = None
        profile.must_change_pin = True
        profile.save(
            update_fields=[
                "pin_verifier",
                "failed_sign_ins",
                "locked_until",
                "must_change_pin",
                "updated_at",
            ]
        )

        notify_account_change(
            request.user,
            "a staff PIN was reset",
            f"The PIN for {staff.full_name} ({staff.phone}) was reset.",
        )
        return Response(StaffSerializer(staff).data, status=status.HTTP_200_OK)


class ConfirmStaffSignInView(APIView):
    """POST /api/auth/staff-sign-in/confirm

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

        staff = (
            User.objects.select_related("staff_profile")
            .filter(phone=data["phone"], staff_profile__isnull=False)
            .first()
        )
        if staff is None or not staff.staff_profile.pin_verifier:
            return error(
                "invalid_credentials",
                "That phone number and PIN do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )

        now = timezone.now()
        with transaction.atomic():
            profile = (
                StaffProfile.objects.select_for_update()
                .select_related("user")
                .filter(user=staff)
                .first()
            )
            if profile is None or not profile.pin_verifier:
                return error(
                    "invalid_credentials",
                    "That phone number and PIN do not match.",
                    status.HTTP_401_UNAUTHORIZED,
                )
            if profile.locked_until and profile.locked_until > now:
                return error(
                    "too_many_attempts",
                    "Too many tries. Try again later.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                )

            if not check_password(data["pin"], profile.pin_verifier):
                profile.failed_sign_ins += 1
                update_fields = ["failed_sign_ins", "updated_at"]
                if profile.failed_sign_ins >= STAFF_LOCK_AFTER:
                    profile.locked_until = now + STAFF_LOCK_FOR
                    profile.failed_sign_ins = 0
                    update_fields.append("locked_until")
                profile.save(update_fields=update_fields)
                return error(
                    "invalid_credentials",
                    "That phone number and PIN do not match.",
                    status.HTTP_401_UNAUTHORIZED,
                )

            profile.failed_sign_ins = 0
            profile.locked_until = None
            update_fields = ["failed_sign_ins", "locked_until", "updated_at"]
            if data.get("newPin"):
                # The staff member's own PIN replaces the one the owner gave.
                profile.pin_verifier = make_password(data["newPin"])
                profile.must_change_pin = False
                update_fields += ["pin_verifier", "must_change_pin"]
            if profile.first_signed_in_at is None and not profile.must_change_pin:
                profile.first_signed_in_at = now
                update_fields.append("first_signed_in_at")
            profile.save(update_fields=update_fields)
            must_change_pin = profile.must_change_pin

        membership = (
            Membership.objects.select_related("shop__owner")
            .filter(
                user=staff,
                role=Membership.Role.ASSISTANT,
                is_active=True,
                shop__is_active=True,
            )
            .first()
        )
        if membership is None:
            return error(
                "invalid_credentials",
                "That phone number and PIN do not match.",
                status.HTTP_401_UNAUTHORIZED,
            )

        owner = membership.shop.owner
        return Response(
            {
                "staff": StaffSerializer(staff).data,
                "owner": {"name": owner.full_name, "phone": owner.phone},
                # True until the staff member chooses their own PIN; the app
                # then sends the same request again with newPin.
                "mustChangePin": must_change_pin,
            },
            status=status.HTTP_200_OK,
        )


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get_object(self):
        return self.request.user
