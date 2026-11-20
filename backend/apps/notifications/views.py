from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.shop_scope import ShopScopedMixin

from .models import Notification
from .serializers import NotificationSerializer
from .services import generate_reminders


class NotificationViewSet(ShopScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """SMS preview: what the owner was (or would be) sent."""

    owner_only = True
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("kind"):
            qs = qs.filter(kind=self.request.query_params["kind"])
        return qs

    @action(detail=False, methods=["post"], url_path="run-reminders")
    def run_reminders(self, request):
        """Trigger the daily reminder job for this shop (demo helper; cron runs it in production)."""
        created = generate_reminders(self.shop)
        return Response(NotificationSerializer(created, many=True).data)
