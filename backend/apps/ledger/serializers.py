from rest_framework import serializers

from .models import LedgerEntry

INCOME_CATEGORIES = {"sales", "other_income"}


class LedgerEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerEntry
        fields = [
            "id", "entry_type", "category", "amount", "description", "entry_date",
            "source", "verification", "sale", "is_void", "created_at",
        ]
        read_only_fields = ["id", "source", "verification", "sale", "is_void", "created_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be more than zero.")
        return value

    def validate(self, attrs):
        t = attrs.get("entry_type", getattr(self.instance, "entry_type", None))
        c = attrs.get("category", getattr(self.instance, "category", None))
        if t and c and (c in INCOME_CATEGORIES) != (t == LedgerEntry.Type.INCOME):
            raise serializers.ValidationError({"category": f"'{c}' does not fit an {t} entry."})
        return attrs
