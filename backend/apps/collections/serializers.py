from rest_framework import serializers

from apps.core.utils import validate_zm_phone

from .models import PaymentRequest

# A shop counter takes small payments; this stops a mistyped extra zero.
MAX_REQUEST_NGWEE = 5_000_000  # K50,000


class PaymentRequestCreateSerializer(serializers.Serializer):
    id = serializers.RegexField(r"^[A-Za-z0-9_\-]{8,64}$")
    provider = serializers.ChoiceField(choices=PaymentRequest.Provider.choices)
    phone = serializers.CharField(max_length=32)
    amount = serializers.IntegerField(min_value=1, max_value=MAX_REQUEST_NGWEE)

    def validate_phone(self, value):
        try:
            return validate_zm_phone(value)
        except Exception as exc:  # Django ValidationError -> DRF error
            raise serializers.ValidationError(str(getattr(exc, "message", exc))) from exc


class FeeQuoteSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1, max_value=MAX_REQUEST_NGWEE)


class PaymentRequestSerializer(serializers.ModelSerializer):
    amount = serializers.IntegerField(source="amount_ngwee")
    fee = serializers.IntegerField(source="fee_ngwee")
    charged = serializers.IntegerField(source="charged_ngwee")
    reference = serializers.CharField(source="provider_reference")
    createdAt = serializers.DateTimeField(source="created_at")
    completedAt = serializers.DateTimeField(source="completed_at")

    class Meta:
        model = PaymentRequest
        fields = [
            "id",
            "provider",
            "phone",
            "amount",
            "fee",
            "charged",
            "status",
            "reference",
            "reason",
            "createdAt",
            "completedAt",
        ]
