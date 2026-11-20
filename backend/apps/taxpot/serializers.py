from rest_framework import serializers

from . import services
from .models import SavingsTarget, TaxPotTransaction


class SavingsTargetSerializer(serializers.ModelSerializer):
    saved = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    percent = serializers.SerializerMethodField()

    class Meta:
        model = SavingsTarget
        fields = [
            "id", "name", "target_amount", "due_date", "approach", "estimate", "is_active",
            "saved", "remaining", "percent", "created_at",
        ]
        read_only_fields = ["id", "estimate", "saved", "remaining", "percent", "created_at"]

    def _p(self, obj):
        return services.progress(obj)

    def get_saved(self, obj):
        return self._p(obj)["saved"]

    def get_remaining(self, obj):
        return self._p(obj)["remaining"]

    def get_percent(self, obj):
        return self._p(obj)["percent"]

    def validate_target_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Target must be more than zero.")
        return value


class FromEstimateSerializer(serializers.Serializer):
    estimate_id = serializers.IntegerField()
    due_date = serializers.DateField()
    approach = serializers.ChoiceField(choices=SavingsTarget.Approach.choices, default="daily")
    name = serializers.CharField(max_length=150, required=False)


class ContributeSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0.01)
    source = serializers.ChoiceField(choices=["suggested", "voluntary"], default="voluntary")


class AmountSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0.01)


class TransactionSerializer(serializers.ModelSerializer):
    target_name = serializers.CharField(source="target.name", read_only=True, default=None)

    class Meta:
        model = TaxPotTransaction
        fields = ["id", "kind", "source", "amount", "balance_after", "target", "target_name", "is_simulated", "note", "created_at"]
