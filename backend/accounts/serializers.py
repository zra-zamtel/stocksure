import re

from rest_framework import serializers

from .models import Owner, Staff

PHONE_RE = re.compile(r"^0\d{9}$")
# Matches the phone's format: sha256$<32 hex characters>$<64 hex characters>.
PIN_HASH_RE = re.compile(r"^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$", re.IGNORECASE)


def normalise_phone(raw: str) -> str:
    """Accept the same spellings as the mobile app, store 0971234567."""
    trimmed = raw.strip()
    digits = re.sub(r"\D", "", trimmed)

    if trimmed.startswith("+260"):
        return f"0{digits[3:]}"
    if digits.startswith("260") and len(digits) == 12:
        return f"0{digits[3:]}"
    if digits.startswith("00260"):
        return f"0{digits[5:]}"
    if len(digits) == 9:
        return f"0{digits}"
    return digits


def validate_phone_value(value: str) -> str:
    phone = normalise_phone(value)
    if not PHONE_RE.match(phone):
        raise serializers.ValidationError("Enter a phone number like 097 123 4567.")
    return phone


def validate_pin_hash_value(value: str) -> str:
    if not PIN_HASH_RE.match(value):
        raise serializers.ValidationError("Send a salted PIN hash, never the PIN itself.")
    return value


class OwnerRegistrationSerializer(serializers.Serializer):
    """Validates a registration request; the view decides create vs retry."""

    id = serializers.CharField(max_length=64)
    name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(
        min_length=8,
        max_length=128,
        trim_whitespace=False,
        write_only=True,
        error_messages={"min_length": "Use at least 8 characters for the password."},
    )
    pinHash = serializers.CharField(max_length=255)

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
        return validate_pin_hash_value(value)


class OwnerLoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


class MagicLinkRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


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


class OwnerSerializer(serializers.ModelSerializer):
    """Public owner fields. Password and PIN hashes never leave the server."""

    class Meta:
        model = Owner
        fields = ["id", "name", "phone", "email"]


class StaffRegistrationSerializer(serializers.Serializer):
    """The owner's phone registers a staff member before the row is cached."""

    id = serializers.CharField(max_length=64)
    ownerId = serializers.CharField(max_length=64)
    name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32)
    pin = serializers.RegexField(
        r"^\d{4,6}$",
        write_only=True,
        error_messages={"invalid": "The staff PIN must be 4 to 6 digits."},
    )
    pinHash = serializers.CharField(max_length=255)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter the staff member's name.")
        return name

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)

    def validate_pinHash(self, value: str) -> str:
        return validate_pin_hash_value(value)


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
    """Public staff fields. The PIN hash never leaves the server."""

    role = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = ["id", "name", "phone", "role"]

    def get_role(self, staff: Staff) -> str:
        return "staff"
