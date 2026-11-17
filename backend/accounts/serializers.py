import re

from rest_framework import serializers

from .models import Owner

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
    pinHash = serializers.CharField(max_length=255)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter the owner's name.")
        return name

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)

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
    """Public owner fields. The PIN hash never leaves the server."""

    class Meta:
        model = Owner
        fields = ["id", "name", "phone"]
