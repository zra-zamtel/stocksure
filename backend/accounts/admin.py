from django.contrib import admin

from .models import DeviceSession, MagicLinkToken, Owner, PinResetCode, Staff


@admin.register(Owner)
class OwnerAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "email", "email_verified_at", "created_at")
    search_fields = ("name", "phone", "email")


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "owner", "first_signed_in_at", "created_at")
    search_fields = ("name", "phone")


@admin.register(MagicLinkToken)
class MagicLinkTokenAdmin(admin.ModelAdmin):
    list_display = ("owner", "created_at", "expires_at", "used_at")
    readonly_fields = ("token_hash",)


@admin.register(DeviceSession)
class DeviceSessionAdmin(admin.ModelAdmin):
    list_display = ("owner", "created_at", "expires_at", "last_seen_at", "revoked_at")
    readonly_fields = ("token_hash",)


@admin.register(PinResetCode)
class PinResetCodeAdmin(admin.ModelAdmin):
    list_display = ("owner", "created_at", "expires_at", "attempts", "used_at")
    readonly_fields = ("code_hash",)
