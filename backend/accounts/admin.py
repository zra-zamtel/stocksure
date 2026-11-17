from django.contrib import admin

from .models import Owner, PinResetCode


@admin.register(Owner)
class OwnerAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "created_at")
    search_fields = ("name", "phone")


@admin.register(PinResetCode)
class PinResetCodeAdmin(admin.ModelAdmin):
    list_display = ("owner", "created_at", "expires_at", "attempts", "used_at")
    readonly_fields = ("code_hash",)
