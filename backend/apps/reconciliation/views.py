from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.shop_scope import ShopScopedMixin
from apps.core.utils import local_today, parse_date

from . import services
from .models import DailyClose
from .serializers import DailyCloseCreateSerializer, DailyCloseSerializer


class DailyCloseViewSet(ShopScopedMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                        mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Daily close: expected cash vs declared cash, with any gap flagged and the owner alerted by SMS."""

    queryset = DailyClose.objects.all()
    serializer_class = DailyCloseSerializer
    owner_actions = {"destroy"}  # destroy == reopen the day

    @action(detail=False, methods=["get"])
    def preview(self, request):
        """What the till should hold. GET /daily-closes/preview/?date=2026-11-17 (default: today)."""
        date = parse_date(request.query_params["date"]) if request.query_params.get("date") else local_today()
        data = services.compute_day(self.shop, date)
        data["already_closed"] = DailyClose.objects.filter(shop=self.shop, date=date).exists()
        return Response(data)

    def create(self, request, *args, **kwargs):
        s = DailyCloseCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        close = services.close_day(
            shop=self.shop, user=request.user, date=d.get("date") or local_today(),
            declared_cash=d["declared_cash"], note=d["note"],
        )
        return Response(DailyCloseSerializer(close).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        services.reopen_day(instance)
