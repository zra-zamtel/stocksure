from django.db import transaction
from rest_framework import serializers

from apps.accounts.models import User
from apps.core.utils import validate_zm_phone

from .models import Membership, Shop


class ShopSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Shop
        fields = [
            "id", "name", "town", "address", "mode", "tpin", "zamtel_merchant_number",
            "cash_tolerance", "is_active", "role", "created_at",
        ]
        read_only_fields = ["id", "is_active", "role", "created_at"]

    def get_role(self, obj):
        return self.context.get("roles", {}).get(obj.id)


class AssistantSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = Membership
        fields = ["user_id", "phone", "full_name", "is_active", "created_at"]


class AssistantCreateSerializer(serializers.Serializer):
    phone = serializers.CharField()
    full_name = serializers.CharField(max_length=150)
    pin = serializers.CharField(write_only=True, min_length=4, max_length=20)

    def validate_phone(self, value):
        phone = validate_zm_phone(value)
        if User.objects.filter(phone=phone).exists():
            raise serializers.ValidationError("This phone number is already registered.")
        return phone

    @transaction.atomic
    def create(self, data):
        shop = self.context["shop"]
        user = User.objects.create_user(phone=data["phone"], password=data["pin"], full_name=data["full_name"])
        return Membership.objects.create(user=user, shop=shop, role=Membership.Role.ASSISTANT)
