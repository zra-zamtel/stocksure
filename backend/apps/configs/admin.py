from django.contrib import admin, messages

from .models import ConfigVersion


@admin.register(ConfigVersion)
class ConfigVersionAdmin(admin.ModelAdmin):
    list_display = ("kind", "version", "is_published", "validated_with_zra", "published_at", "created_at")
    list_filter = ("kind", "is_published", "validated_with_zra")
    readonly_fields = ("checksum", "published_at")
    actions = ["publish_selected"]

    @admin.action(description="Publish selected versions (the app will pick them up)")
    def publish_selected(self, request, queryset):
        done = 0
        for cfg in queryset.order_by("kind", "version"):
            cfg.is_published = True
            try:
                cfg.save()
                done += 1
            except Exception as exc:  # a validation failure keeps the last good version live
                self.message_user(request, f"{cfg}: not published. {getattr(exc, 'message', exc)}", messages.ERROR)
        if done:
            self.message_user(request, f"{done} version(s) published.", messages.SUCCESS)
