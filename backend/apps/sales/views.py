import hmac
import secrets
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.exceptions import Conflict
from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import parse_date, validate_zm_phone
from apps.shops.models import Shop

from . import matching, services
from .models import MobilePayment, Sale
from .serializers import (
    ManualMatchSerializer, MobilePaymentSerializer, SaleCreateSerializer, SaleSerializer,
    SimulatePaymentSerializer, VoidSerializer,
)


MAX_SYNC_ROWS = 500


def _record(view, data):
    sale, created, warnings = services.record_sale(
        shop=view.shop, user=view.request.user, role=view.membership.role,
        payment_method=data["payment_method"], lines=data.get("lines"), amount=data.get("amount"),
        client_id=data.get("client_id"), sold_at=data.get("sold_at"),
        payer_phone=data.get("payer_phone", ""), payment_reference=data.get("payment_reference", ""),
        note=data.get("note", ""), allow_oversell=data.get("allow_oversell", False),
    )
    return sale, created, warnings


class SaleViewSet(ShopScopedMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                  mixins.ListModelMixin, viewsets.GenericViewSet):
    """Quick sale entry (replaces the sales book). Assistants see only the sales they recorded."""

    queryset = Sale.objects.select_related("recorded_by", "ledger_entry").prefetch_related("lines")
    serializer_class = SaleSerializer
    owner_actions = {"void"}
    search_fields = ["payment_reference", "payer_phone", "note"]
    ordering_fields = ["sold_at", "total"]

    def get_serializer_class(self):
        return SaleCreateSerializer if self.action == "create" else SaleSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.membership and self.membership.role != "owner":
            qs = qs.filter(recorded_by=self.request.user)
        p = self.request.query_params
        if p.get("date"):
            qs = qs.filter(sale_date=parse_date(p["date"]))
        if p.get("from"):
            qs = qs.filter(sale_date__gte=parse_date(p["from"], "from"))
        if p.get("to"):
            qs = qs.filter(sale_date__lte=parse_date(p["to"], "to"))
        for field in ("payment_method", "status", "match_status"):
            if p.get(field):
                qs = qs.filter(**{field: p[field]})
        return qs

    def create(self, request, *args, **kwargs):
        s = SaleCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        sale, created, warnings = _record(self, s.validated_data)
        body = SaleSerializer(sale).data
        body["warnings"] = warnings
        return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def sync(self, request):
        """Offline sync: send {"sales": [...]} (each with a phone-generated client_id).
        Every sale is processed on its own, so one bad row does not block the rest."""
        rows = request.data.get("sales")
        if not isinstance(rows, list) or not rows:
            raise ValidationError({"sales": "Send a non-empty list of sales."})
        results = []
        for row in rows[:MAX_SYNC_ROWS]:
            s = SaleCreateSerializer(data=row)
            if not s.is_valid() or not s.validated_data.get("client_id"):
                errors = s.errors or {"client_id": ["client_id is required for offline sync."]}
                results.append({"client_id": row.get("client_id"), "status": "error", "errors": errors})
                continue
            try:
                with transaction.atomic():
                    sale, created, warnings = _record(self, s.validated_data)
                results.append({
                    "client_id": str(sale.client_id), "status": "created" if created else "duplicate",
                    "sale_id": sale.id, "warnings": warnings,
                })
            except (ValidationError, Conflict) as exc:
                results.append({"client_id": str(s.validated_data["client_id"]), "status": "error", "errors": exc.detail})
        # Never drop the tail silently. Tell the phone which rows still need
        # sending in a second batch.
        for row in rows[MAX_SYNC_ROWS:]:
            results.append({
                "client_id": row.get("client_id") if isinstance(row, dict) else None,
                "status": "error",
                "errors": {"detail": f"Batch limit is {MAX_SYNC_ROWS} rows. Send the remaining rows in another request."},
            })
        return Response({"results": results})

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        """Owner-only. Puts the stock back and removes the sale from the ledger."""
        sale = self.get_object()
        s = VoidSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.void_sale(sale=sale, user=request.user, reason=s.validated_data["reason"])
        return Response(SaleSerializer(sale).data)


class MobilePaymentViewSet(ShopScopedMixin, mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = MobilePayment.objects.all()
    serializer_class = MobilePaymentSerializer
    owner_actions = {"manual_match", "simulate"}

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    @action(detail=False, methods=["post"])
    def simulate(self, request):
        """Prototype only: pretend Zamtel just notified us of a payment on the shop's merchant number."""
        if not getattr(settings, "ALLOW_PAYMENT_SIMULATION", False):
            raise PermissionDenied("Payment simulation is disabled.")
        s = SimulatePaymentSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        phone = validate_zm_phone(d["payer_phone"]) if d["payer_phone"] else ""
        payment, _ = services.register_payment(
            shop=self.shop, reference=d.get("reference") or f"SIM-{secrets.token_hex(4).upper()}",
            amount=d["amount"], payer_phone=phone, source=MobilePayment.Source.SIMULATED,
        )
        return Response(MobilePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="match")
    def manual_match(self, request, pk=None):
        """Owner links a payment to a sale by hand (e.g. the customer paid a slightly different amount)."""
        payment = self.get_object()
        s = ManualMatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if payment.status == MobilePayment.Status.MATCHED:
            raise Conflict("This payment is already matched.")
        sale = Sale.objects.filter(
            shop=self.shop, pk=s.validated_data["sale_id"], status=Sale.Status.RECORDED,
            payment_method=Sale.Method.MOBILE_MONEY, match_status=Sale.Match.PENDING,
        ).first()
        if not sale:
            raise NotFound("No unmatched mobile-money sale with that id.")
        matching.link(sale, payment)
        payment.refresh_from_db()
        return Response(MobilePaymentSerializer(payment).data)


class ZamtelWebhookView(APIView):
    """Inbound payment notification. The payload shape below is a placeholder: map it to Zamtel's
    real format when the integration is agreed. Protected by a shared secret header."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "webhook"

    def post(self, request):
        secret = request.headers.get("X-Webhook-Secret", "")
        expected = getattr(settings, "ZAMTEL_WEBHOOK_SECRET", "")
        if not expected:
            if not settings.DEBUG:
                raise PermissionDenied("Webhook secret is not configured.")
        elif not hmac.compare_digest(secret, expected):
            raise PermissionDenied("Bad webhook secret.")
        d = request.data
        shop = Shop.objects.filter(zamtel_merchant_number=str(d.get("merchant_number", "")), is_active=True).first()
        if not shop:
            raise NotFound("Unknown merchant number.")
        if not d.get("reference") or not d.get("amount"):
            raise ValidationError("'reference' and 'amount' are required.")
        try:
            amount = Decimal(str(d["amount"]))
        except InvalidOperation:
            raise ValidationError({"amount": "Not a valid number."})
        if amount <= 0:
            raise ValidationError({"amount": "Must be more than zero."})
        payment, created = services.register_payment(
            shop=shop, reference=str(d["reference"]), amount=amount,
            payer_phone=str(d.get("payer_phone", "")), source=MobilePayment.Source.WEBHOOK,
        )
        return Response(MobilePaymentSerializer(payment).data, status=201 if created else 200)
