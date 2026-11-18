from django.contrib import admin

from .models import ChangeLog, SyncRecord


class ReadOnlyAdmin(admin.ModelAdmin):
    """Synced data is written only by the phones (and USSD). The admin is for looking, not editing."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SyncRecord)
class SyncRecordAdmin(ReadOnlyAdmin):
    list_display = ("entity", "entity_id", "tenant", "state", "num", "updated_at_client")
    list_filter = ("entity",)
    search_fields = ("entity_id",)


@admin.register(ChangeLog)
class ChangeLogAdmin(ReadOnlyAdmin):
    list_display = ("seq", "tenant", "entity", "entity_id", "operation", "device_id", "created_at")
    list_filter = ("entity", "operation")
    search_fields = ("entity_id", "device_id")
