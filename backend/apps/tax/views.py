from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import parse_month

from . import services
from .models import DISCLAIMER, TaxEstimate, TaxRuleSet
from .serializers import EstimateRequestSerializer, TaxEstimateSerializer, TaxRuleSetSerializer


def _period(data):
    if data.get("month"):
        return parse_month(data["month"])
    return data["start"], data["end"]


class TaxRuleSetViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only for the app (to show which rules and version an estimate used). Edited in the admin."""

    permission_classes = [IsAuthenticated]
    queryset = TaxRuleSet.objects.filter(is_active=True)
    serializer_class = TaxRuleSetSerializer


class TaxEstimateViewSet(ShopScopedMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                         mixins.ListModelMixin, viewsets.GenericViewSet):
    owner_only = True
    queryset = TaxEstimate.objects.select_related("rule_set")
    serializer_class = TaxEstimateSerializer

    def create(self, request, *args, **kwargs):
        """Calculate and save an estimate: {"month": "2026-11"} or {"start": ..., "end": ...}."""
        s = EstimateRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        start, end = _period(s.validated_data)
        result = services.compute_estimate(self.shop, start, end, s.validated_data["include_unverified"])
        model_fields = {field.name for field in TaxEstimate._meta.fields}
        estimate = TaxEstimate.objects.create(
            shop=self.shop,
            created_by=request.user,
            **{k: v for k, v in result.items() if k in model_fields},
        )
        return Response(TaxEstimateSerializer(estimate).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def preview(self, request):
        """Same calculation, nothing saved: ?month=2026-11 or ?start=&end=&include_unverified=false"""
        params = dict(request.query_params.items())
        # Plain dict + explicit default: HTML-style QueryDict input would treat a missing boolean as False.
        params["include_unverified"] = params.get("include_unverified", "true").lower() not in ("0", "false", "no")
        s = EstimateRequestSerializer(data=params)
        s.is_valid(raise_exception=True)
        start, end = _period(s.validated_data)
        r = services.compute_estimate(self.shop, start, end, s.validated_data["include_unverified"])
        r["rule_set"] = TaxRuleSetSerializer(r["rule_set"]).data
        r["label"] = "Estimate only - not an official ZRA assessment"
        r["disclaimer"] = DISCLAIMER
        return Response(r)
