from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.shop_scope import ShopScopedMixin
from apps.tax.models import TaxEstimate

from . import services
from .models import SavingsTarget, TaxPotTransaction
from .serializers import (
    AmountSerializer,
    ContributeSerializer,
    FromEstimateSerializer,
    SavingsTargetSerializer,
    TransactionSerializer,
)


class WalletView(ShopScopedMixin, APIView):
    owner_only = True

    def get(self, request):
        wallet = services.get_wallet(self.shop)
        targets = SavingsTarget.objects.filter(shop=self.shop, is_active=True)
        return Response({
            "balance": wallet.balance,
            "simulated": True,
            "notice": "Simulated wallet: deposits, balances and payments do not move real money.",
            "targets": SavingsTargetSerializer(targets, many=True).data,
        })


class SavingsTargetViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    owner_only = True
    queryset = SavingsTarget.objects.filter(is_active=True)
    serializer_class = SavingsTargetSerializer

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=False, methods=["post"], url_path="from-estimate")
    def from_estimate(self, request):
        """Make the estimated tax for a period the savings target."""
        s = FromEstimateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        est = TaxEstimate.objects.filter(shop=self.shop, pk=d["estimate_id"]).first()
        if not est:
            raise NotFound("Estimate not found.")
        target = SavingsTarget.objects.create(
            shop=self.shop, estimate=est, target_amount=est.estimated_tax, due_date=d["due_date"],
            approach=d["approach"],
            name=d.get("name") or f"Tax set-aside {est.period_start:%b %Y} - {est.period_end:%b %Y} (estimate)",
        )
        return Response(SavingsTargetSerializer(target).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def suggestion(self, request, pk=None):
        return Response(services.suggestion(self.get_object()))

    @action(detail=True, methods=["post"])
    def contribute(self, request, pk=None):
        """Accept the suggestion (source=suggested), change the amount, or save any amount (voluntary)."""
        target = self.get_object()
        s = ContributeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tx = services.contribute(
            shop=self.shop, target=target, amount=s.validated_data["amount"],
            source=s.validated_data["source"], user=request.user,
        )
        return Response({
            "transaction": TransactionSerializer(tx).data,
            "target": SavingsTargetSerializer(target).data,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        services.skip_suggestion(self.get_object())
        return Response({"detail": "Skipped for now."})

    @action(detail=True, methods=["get"], url_path="prepare-payment")
    def prepare_payment(self, request, pk=None):
        return Response(services.prepare_payment(self.shop, self.get_object()))

    @action(detail=True, methods=["post"], url_path="simulate-payment")
    def simulate_payment(self, request, pk=None):
        s = AmountSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tx = services.simulate_payment(
            shop=self.shop, target=self.get_object(), amount=s.validated_data["amount"], user=request.user
        )
        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)


class TransactionViewSet(ShopScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    owner_only = True
    queryset = TaxPotTransaction.objects.select_related("target")
    serializer_class = TransactionSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TaxPotTransaction.objects.none()
        return TaxPotTransaction.objects.select_related("target").filter(wallet__shop=self.shop)
