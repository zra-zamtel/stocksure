from rest_framework import serializers

from .models import User


def user_payload(user: User) -> dict:
    """What the app needs to know about the signed-in person."""
    owner = user if user.role == User.Role.OWNER else user.owner
    return {
        "id": user.app_id,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "ownerId": owner.app_id if owner else None,
        "isActive": user.is_active,
    }


class RegisterSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=80, required=False, allow_blank=True)
    name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=20)
    pin = serializers.CharField(max_length=10)


class LoginSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    pin = serializers.CharField(max_length=10)


class PinResetRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)


class PinResetConfirmSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(max_length=10)
    new_pin = serializers.CharField(max_length=10)


class ChangePinSerializer(serializers.Serializer):
    old_pin = serializers.CharField(max_length=10)
    new_pin = serializers.CharField(max_length=10)


class StaffCreateSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=80)
    name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=20)
    pin = serializers.CharField(max_length=10)


class StaffPinSerializer(serializers.Serializer):
    new_pin = serializers.CharField(max_length=10)
