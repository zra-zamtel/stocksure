from rest_framework import serializers

from .models import MobilePayment, Sale, SaleLine


class SaleLineInputSerializer(serializers.Serializer):
    item = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=150, required=False, allow_blank=True)
    quantity = serializers.IntegerField(min_value=1, default=1)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)


class SaleCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField(required=False)
    payment_method = serializers.ChoiceField(choices=Sale.Method.choices)
    lines = SaleLineInputSerializer(many=True, required=False)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=0.01)
    sold_at = serializers.DateTimeField(required=False)
    payer_phone = serializers.CharField(max_length=15, required=False, allow_blank=True, default="")
    payment_reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs.get("lines") and attrs.get("amount") is None:
            raise serializers.ValidationError("Send either 'lines' (items sold) or an 'amount'.")
        if attrs.get("lines") and attrs.get("amount") is not None:
            raise serializers.ValidationError("Send 'lines' or 'amount', not both.")
        return attrs


class SaleLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleLine
        fields = ["id", "item", "description", "quantity", "unit_price", "line_total"]


class SaleSerializer(serializers.ModelSerializer):
    lines = SaleLineSerializer(many=True, read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.full_name", read_only=True, default="")
    verification = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = [
            "id", "client_id", "payment_method", "total", "status", "match_status", "verification",
            "sold_at", "sale_date", "payer_phone", "payment_reference", "note", "recorded_by",
            "recorded_by_name", "void_reason", "lines",
        ]

    def get_verification(self, obj):
        entry = getattr(obj, "ledger_entry", None)
        return entry.verification if entry else None


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class MobilePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MobilePayment
        fields = ["id", "provider_ref", "payer_phone", "amount", "received_at", "status", "sale", "source"]
        read_only_fields = fields


class SimulatePaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0.01)
    payer_phone = serializers.CharField(max_length=15, required=False, allow_blank=True, default="")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True)


class ManualMatchSerializer(serializers.Serializer):
    sale_id = serializers.IntegerField()
