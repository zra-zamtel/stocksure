from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "shop", "kind", "recipient_phone", "status")
    list_filter = ("kind", "status")
