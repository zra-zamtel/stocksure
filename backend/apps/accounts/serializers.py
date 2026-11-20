import re

from rest_framework import serializers

from apps.core.utils import normalize_phone, validate_zm_phone
from apps.shops.models import Membership, Shop

from .models import User

PHONE_RE = re.compile(r"^260\d{9}$")
# Matches the phone's format: sha256$<32 hex characters>$<64 hex characters>.
PIN_HASH_RE = re.compile(r"^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$", re.IGNORECASE)


def validate_phone_value(value: str) -> str:
    return validate_zm_phone(value)


def validate_pin_hash_value(value: str) -> str:
    if not PIN_HASH_RE.match(value):
        raise serializers.ValidationError("Send a salted PIN hash, never the PIN itself.")
    return value


class MembershipBriefSerializer(serializers.ModelSerializer):
    shop_id = serializers.IntegerField(source="shop.id")
    shop_name = serializers.CharField(source="shop.name")
    mode = serializers.CharField(source="shop.mode")

    class Meta:
        model = Membership
        fields = ["shop_id", "shop_name", "mode", "role"]


class MeSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="full_name", read_only=True)
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "phone", "full_name", "name", "email", "language", "is_staff", "memberships"]
        read_only_fields = ["id", "phone", "email", "is_staff", "memberships"]

    def get_memberships(self, user):
        qs = user.memberships.select_related("shop").filter(is_active=True, shop__is_active=True)
        return MembershipBriefSerializer(qs, many=True).data


class OwnerSerializer(serializers.ModelSerializer):
    """Public owner fields in the shape the mobile app already uses."""

    id = serializers.SerializerMethodField()
    name = serializers.CharField(source="full_name")

    class Meta:
        model = User
        fields = ["id", "name", "phone", "email"]

    def get_id(self, obj) -> str:
        return str(obj.id)


class OwnerRegistrationSerializer(serializers.Serializer):
    """Owner signup for both clients.

    The mobile app sends ``id`` plus a PIN hash; the domain client sends
    ``shop_name`` instead. The PIN hash is validated shape-wise and then
    discarded: the phone checks the PIN offline, and the server never stores a
    copy it does not need.
    """

    id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=32)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(
        min_length=8,
        max_length=128,
        trim_whitespace=False,
        write_only=True,
        error_messages={"min_length": "Use at least 8 characters for the password."},
    )
    pinHash = serializers.CharField(max_length=255, required=False, allow_blank=True, write_only=True)
    shop_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    town = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    mode = serializers.ChoiceField(choices=Shop.Mode.choices, required=False, default=Shop.Mode.LITE)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter the owner's name.")
        return name

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_pinHash(self, value: str) -> str:
        return validate_pin_hash_value(value) if value else ""


class LoginSerializer(serializers.Serializer):
    """Email + password for the app, or phone + password for the domain API."""

    email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value) if value.strip() else ""

    def validate(self, attrs):
        email = attrs.get("email", "").strip()
        phone = attrs.get("phone", "").strip()
        if bool(email) == bool(phone):
            raise serializers.ValidationError("Send either an email address or a phone number.")
        return attrs


class MagicLinkRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    # Required only while the email is unverified. The owner knows the phone
    # number on their own account; someone who merely received the email does
    # not. This stops an unverified address from handing a stranger's account
    # to the inbox owner.
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value) if value.strip() else ""


class MagicLinkVerifySerializer(serializers.Serializer):
    token = serializers.CharField(min_length=20, max_length=128)


class DevicePinSerializer(serializers.Serializer):
    pinHash = serializers.CharField(max_length=255)

    def validate_pinHash(self, value: str) -> str:
        return validate_pin_hash_value(value)


class PinResetRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)


class PinResetConfirmSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    code = serializers.RegexField(
        r"^\d{6}$",
        error_messages={"invalid": "Enter the 6-digit reset code."},
    )
    pinHash = serializers.CharField(max_length=255)

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)

    def validate_pinHash(self, value: str) -> str:
        return validate_pin_hash_value(value)


class StaffRegistrationSerializer(serializers.Serializer):
    """The owner's phone registers a staff member before the row is cached."""

    id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    ownerId = serializers.CharField(max_length=64, required=False, allow_blank=True)
    name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=32)
    pin = serializers.RegexField(
        r"^\d{4,6}$",
        write_only=True,
        error_messages={"invalid": "The staff PIN must be 4 to 6 digits."},
    )

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter the staff member's name.")
        return name

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)


class StaffPinResetSerializer(serializers.Serializer):
    """An owner replacing a staff member's PIN. The phone keeps its own hash;
    the server builds the Django verifier used by the next first sign-in."""

    pin = serializers.RegexField(
        r"^\d{4,6}$",
        write_only=True,
        error_messages={"invalid": "The staff PIN must be 4 to 6 digits."},
    )


class StaffSignInConfirmSerializer(serializers.Serializer):
    """First staff sign-in on a phone. The PIN crosses TLS once; the server
    checks a Django password hash and the phone caches its own salted hash."""

    phone = serializers.CharField(max_length=32)
    pin = serializers.RegexField(
        r"^\d{4,6}$",
        write_only=True,
        error_messages={"invalid": "Enter the 4 to 6 digit PIN."},
    )

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)


class StaffSerializer(serializers.ModelSerializer):
    """Public staff fields. The PIN verifier never leaves the server."""

    id = serializers.SerializerMethodField()
    name = serializers.CharField(source="full_name")
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name", "phone", "role"]

    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_role(self, staff) -> str:
        return "staff"
