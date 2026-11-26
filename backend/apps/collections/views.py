import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.shop_scope import ShopScopedMixin

from .fees import customer_fee_ngwee, fee_percent
from .models import PaymentRequest
from .providers import ProviderError, ProviderStatus, get_provider
from .serializers import (
    FeeQuoteSerializer,
    PaymentRequestCreateSerializer,
    PaymentRequestSerializer,
)

logger = logging.getLogger(__name__)


def refresh(payment: PaymentRequest) -> PaymentRequest:
    """Ask the provider where a pending request stands and store the answer.
    Polling (rather than waiting on a callback) suits Lambda; a real provider's
    callback can call this too."""
    if payment.is_final:
        return payment
    with transaction.atomic():
        payment = PaymentRequest.objects.select_for_update().get(pk=payment.pk)
        if payment.is_final:
            return payment
        now = timezone.now()
        try:
            result = get_provider().check(payment)
        except Exception as exc:  # noqa: BLE001 - a blip or 429 while polling must not fail the sale
            logger.warning("Request to pay %s status check failed: %s", payment.id, exc)
            # Still pending, so the timeout below still applies.
            result = ProviderStatus("pending")
        if result.status == "successful":
            payment.status = PaymentRequest.Status.SUCCESSFUL
            # Keep the handle from start() if the provider sends no reference.
            payment.provider_reference = result.reference or payment.provider_reference
            payment.completed_at = now
        elif result.status == "failed":
            payment.status = PaymentRequest.Status.FAILED
            payment.reason = result.reason[:200]
            payment.completed_at = now
        elif now - payment.created_at > timedelta(seconds=settings.COLLECTIONS_TIMEOUT_SECONDS):
            payment.status = PaymentRequest.Status.EXPIRED
            payment.reason = "The customer did not answer in time."
            payment.completed_at = now
        else:
            return payment
        payment.save()
    return payment


class RequestToPayView(ShopScopedMixin, APIView):
    """POST /api/v1/collections/request-to-pay

    Owner or staff at the counter asks the customer's wallet for the amount.
    Sending the same id again returns the existing request (no second prompt).
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "collections"

    def post(self, request):
        serializer = PaymentRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        existing = PaymentRequest.objects.filter(pk=data["id"]).first()
        if existing:
            if existing.shop_id != self.shop.id:
                raise NotFound()
            return Response(PaymentRequestSerializer(refresh(existing)).data, status=status.HTTP_200_OK)

        payment = PaymentRequest.objects.create(
            id=data["id"],
            shop=self.shop,
            requested_by=request.user,
            provider=data["provider"],
            phone=data["phone"],
            amount_ngwee=data["amount"],
            fee_ngwee=customer_fee_ngwee(data["amount"]),
        )
        try:
            get_provider().start(payment)
        except Exception as exc:  # noqa: BLE001 - report the provider failure to the counter
            logger.warning("Request to pay %s could not start: %s", payment.id, exc)
            payment.status = PaymentRequest.Status.FAILED
            payment.reason = (
                str(exc)[:200]
                if isinstance(exc, ProviderError)
                else "The payment service could not be reached. Try again."
            )
            payment.completed_at = timezone.now()
            payment.save()
        else:
            # A provider may have noted its own handle for the request.
            if payment.provider_reference:
                payment.save(update_fields=["provider_reference", "updated_at"])
        return Response(PaymentRequestSerializer(payment).data, status=status.HTTP_201_CREATED)


class RequestToPayStatusView(ShopScopedMixin, APIView):
    """GET /api/v1/collections/request-to-pay/<id> — the app polls this."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "collections_status"

    def get(self, request, request_id):
        payment = PaymentRequest.objects.filter(pk=request_id, shop=self.shop).first()
        if not payment:
            raise NotFound()
        return Response(PaymentRequestSerializer(refresh(payment)).data)


class FeeQuoteView(ShopScopedMixin, APIView):
    """GET /api/v1/collections/quote?amount=<ngwee>

    What the customer will be asked for, so the counter can show the fee
    before the request goes out. Matches what RequestToPayView charges.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "collections_status"

    def get(self, request):
        serializer = FeeQuoteSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        amount = serializer.validated_data["amount"]
        fee = customer_fee_ngwee(amount)
        return Response(
            {"amount": amount, "fee": fee, "charged": amount + fee, "feePercent": str(fee_percent())}
        )
