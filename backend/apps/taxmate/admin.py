from django.contrib import admin
from django.utils import timezone

from .models import ReviewedAnswer, TaxMateQuery


@admin.register(ReviewedAnswer)
class ReviewedAnswerAdmin(admin.ModelAdmin):
    list_display = ("question", "category", "is_reviewed", "reviewed_by", "reviewed_on", "has_nyanja")
    list_filter = ("category", "is_reviewed")
    search_fields = ("question", "keywords", "answer_en")
    actions = ["mark_reviewed"]

    @admin.display(boolean=True)
    def has_nyanja(self, obj):
        return bool(obj.answer_ny)

    @admin.action(description="Mark selected answers as reviewed (by me, today)")
    def mark_reviewed(self, request, queryset):
        queryset.update(is_reviewed=True, reviewed_by=request.user.full_name or request.user.phone, reviewed_on=timezone.localdate())


@admin.register(TaxMateQuery)
class TaxMateQueryAdmin(admin.ModelAdmin):
    list_display = ("created_at", "question", "answered", "score")
    list_filter = ("answered",)
