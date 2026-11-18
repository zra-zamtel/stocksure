from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from . import services
from .models import User
from .serializers import (
    ChangePinSerializer, LoginSerializer, PinResetConfirmSerializer, PinResetRequestSerializer,
    RegisterSerializer, StaffCreateSerializer, StaffPinSerializer, user_payload,
)


def _tokens(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": user_payload(user)}


class IsOwner(BasePermission):
    message = "Only the shop owner can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.OWNER)


class _PublicAuthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class RegisterView(_PublicAuthView):
    """The one online moment: create the owner account. The PIN is hashed here; it is never stored."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        user = services.register_owner(name=d["name"], phone=d["phone"], pin=d["pin"], client_id=d.get("id") or None)
        return Response(_tokens(user), status=status.HTTP_201_CREATED)


class LoginView(_PublicAuthView):
    """PIN sign-in against the server. Needed for a staff member's first sign-in on a new phone and for
    restoring after a lost phone; day-to-day sign-in is verified locally on the phone."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = services.authenticate_pin(s.validated_data["phone"], s.validated_data["pin"])
        return Response(_tokens(user))


class PinResetRequestView(_PublicAuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin_reset"

    def post(self, request):
        s = PinResetRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        code = services.request_pin_reset(s.validated_data["phone"])
        body = {"detail": "If this number is registered as an owner, a code has been sent by SMS."}
        if settings.PIN_RESET_RETURN_CODE and code:
            body["devCode"] = code  # development only
        return Response(body, status=status.HTTP_202_ACCEPTED)


class PinResetConfirmView(_PublicAuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin_reset"

    def post(self, request):
        s = PinResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        user = services.confirm_pin_reset(d["phone"], d["code"], d["new_pin"])
        return Response(_tokens(user))


class MeView(APIView):
    def get(self, request):
        return Response(user_payload(request.user))


class ChangePinView(APIView):
    def post(self, request):
        s = ChangePinSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.change_pin(request.user, s.validated_data["old_pin"], s.validated_data["new_pin"])
        return Response({"detail": "PIN changed."})


class StaffListCreateView(APIView):
    """Owner registers a staff member's sign-in (their phone-generated id, name, phone and PIN)."""

    permission_classes = [IsOwner]

    def get(self, request):
        qs = User.objects.filter(owner=request.user, role=User.Role.STAFF).order_by("name")
        return Response([user_payload(u) for u in qs])

    def post(self, request):
        s = StaffCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        staff, created = services.create_staff(
            owner=request.user, client_id=d["id"], name=d["name"], phone=d["phone"], pin=d["pin"]
        )
        return Response(user_payload(staff), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class StaffResetPinView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, staff_id):
        s = StaffPinSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        staff = services.reset_staff_pin(owner=request.user, client_id=staff_id, new_pin=s.validated_data["new_pin"])
        if staff is None:
            raise NotFound("Staff member not found.")
        return Response({"detail": "PIN reset."})


class StaffDeactivateView(APIView):
    """Stops this person signing in or syncing. Their recorded sales stay in the history."""

    permission_classes = [IsOwner]

    def post(self, request, staff_id):
        staff = User.objects.filter(owner=request.user, role=User.Role.STAFF, client_id=staff_id).first()
        if staff is None:
            raise NotFound("Staff member not found.")
        if staff.pk == request.user.pk:
            raise PermissionDenied()
        staff.is_active = False
        staff.save(update_fields=["is_active"])
        return Response({"detail": "Staff member deactivated."})
