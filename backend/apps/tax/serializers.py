from rest_framework import serializers

from .models import DISCLAIMER, TaxEstimate, TaxRuleSet


class TaxRuleSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRuleSet
        fields = [
            "id", "tax_type", "name", "version", "rate_percent", "annual_turnover_threshold",
            "filing_frequency", "effective_from", "effective_to", "is_validated", "validated_on",
            "source_reference",
        ]


class TaxEstimateSerializer(serializers.ModelSerializer):
    rule_set = TaxRuleSetSerializer(read_only=True)
    label = serializers.SerializerMethodField()
    disclaimer = serializers.SerializerMethodField()

    class Meta:
        model = TaxEstimate
        fields = [
            "id", "label", "period_start", "period_end", "verified_income", "reported_income",
            "include_unverified", "basis_income", "rate_percent", "estimated_tax", "income_tax",
            "year_to_date_turnover", "rules_validated", "rule_set", "assumptions", "warnings",
            "disclaimer", "created_at",
        ]

    def get_label(self, obj):
        return "Estimate only - not an official ZRA assessment"

    def get_disclaimer(self, obj):
        return DISCLAIMER


class EstimateRequestSerializer(serializers.Serializer):
    month = serializers.RegexField(r"^\d{4}-\d{2}$", required=False)
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
    include_unverified = serializers.BooleanField(default=True)

    def validate(self, attrs):
        if not attrs.get("month") and not (attrs.get("start") and attrs.get("end")):
            raise serializers.ValidationError("Send 'month' (YYYY-MM) or both 'start' and 'end'.")
        return attrs
