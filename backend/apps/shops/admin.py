from django.contrib import admin

from .models import Membership, Shop


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0


@admin.register(Shop)
class ShopAdmin(admin.ModelAdmin):
    list_display = ("name", "town", "mode", "owner", "is_active")
    list_filter = ("mode", "town", "is_active")
    search_fields = ("name", "owner__phone")
    inlines = [MembershipInline]
