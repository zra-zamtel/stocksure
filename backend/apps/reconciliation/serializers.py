from rest_framework import serializers

from .models import DailyClose


class DailyCloseSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyClose
        fields = [
            "id", "date", "status", "expected_cash", "declared_cash", "gap", "tolerance_applied",
            "total_sales", "cash_sales_count", "mobile_total", "mobile_sales_count",
            "unmatched_mobile_sales", "unmatched_payments", "note", "created_at",
        ]
        read_only_fields = fields


class DailyCloseCreateSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    declared_cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
