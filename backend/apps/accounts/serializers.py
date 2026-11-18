from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.utils import normalize_phone, validate_zm_phone
from apps.shops.models import Membership, Shop

from .models import User


class MembershipBriefSerializer(serializers.ModelSerializer):
    shop_id = serializers.IntegerField(source="shop.id")
    shop_name = serializers.CharField(source="shop.name")
    mode = serializers.CharField(source="shop.mode")

    class Meta:
        model = Membership
        fields = ["shop_id", "shop_name", "mode", "role"]


class MeSerializer(serializers.ModelSerializer):
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "phone", "full_name", "email", "language", "is_staff", "memberships"]
        read_only_fields = ["id", "phone", "is_staff", "memberships"]

    def get_memberships(self, user):
        qs = user.memberships.select_related("shop").filter(is_active=True, shop__is_active=True)
        return MembershipBriefSerializer(qs, many=True).data


class RegisterSerializer(serializers.Serializer):
    """An owner signs up and creates their first shop in one step."""

    phone = serializers.CharField()
    full_name = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=4, max_length=128)
    shop_name = serializers.CharField(max_length=150)
    town = serializers.CharField(max_length=80, required=False, allow_blank=True)
    mode = serializers.ChoiceField(choices=Shop.Mode.choices, default=Shop.Mode.LITE)

    def validate_phone(self, value):
        phone = validate_zm_phone(value)
        if User.objects.filter(phone=phone).exists():
            raise serializers.ValidationError("This phone number is already registered.")
        return phone

    @transaction.atomic
    def create(self, data):
        user = User.objects.create_user(
            phone=data["phone"], password=data["password"], full_name=data["full_name"]
        )
        shop = Shop.objects.create(
            owner=user, name=data["shop_name"], town=data.get("town", ""), mode=data["mode"]
        )
        Membership.objects.create(user=user, shop=shop, role=Membership.Role.OWNER)
        return user


class PhoneTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        attrs[self.username_field] = normalize_phone(attrs.get(self.username_field, ""))
        data = super().validate(attrs)
        data["user"] = MeSerializer(self.user).data
        return data
