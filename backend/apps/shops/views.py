from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Membership, Shop
from .serializers import AssistantCreateSerializer, AssistantSerializer, ShopSerializer


class ShopViewSet(viewsets.ModelViewSet):
    """Shops the signed-in user belongs to. Owners create/edit; assistants can only read."""

    serializer_class = ShopSerializer
    queryset = Shop.objects.all()
    search_fields = ["name", "town"]

    def get_queryset(self):
        return Shop.objects.filter(
            memberships__user=self.request.user, memberships__is_active=True, is_active=True
        ).distinct()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request and self.request.user.is_authenticated:
            ctx["roles"] = dict(
                Membership.objects.filter(user=self.request.user).values_list("shop_id", "role")
            )
        return ctx

    def _require_owner(self, shop):
        if shop.owner_id != self.request.user.id:
            raise PermissionDenied("Only the shop owner can do this.")

    @transaction.atomic
    def perform_create(self, serializer):
        shop = serializer.save(owner=self.request.user)
        Membership.objects.create(user=self.request.user, shop=shop, role=Membership.Role.OWNER)

    def perform_update(self, serializer):
        self._require_owner(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_owner(instance)
        instance.is_active = False  # never hard-delete: sales history must survive
        instance.save(update_fields=["is_active"])

    @action(detail=True, methods=["get", "post"], url_path="assistants")
    def assistants(self, request, pk=None):
        shop = self.get_object()
        self._require_owner(shop)
        if request.method == "GET":
            qs = shop.memberships.filter(role=Membership.Role.ASSISTANT).select_related("user")
            return Response(AssistantSerializer(qs, many=True).data)
        serializer = AssistantCreateSerializer(data=request.data, context={"shop": shop})
        serializer.is_valid(raise_exception=True)
        membership = serializer.save()
        return Response(AssistantSerializer(membership).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"assistants/(?P<user_id>\d+)")
    def remove_assistant(self, request, pk=None, user_id=None):
        """Deactivate an assistant (their recorded sales stay in the history)."""
        shop = self.get_object()
        self._require_owner(shop)
        updated = Membership.objects.filter(
            shop=shop, user_id=user_id, role=Membership.Role.ASSISTANT
        ).update(is_active=False)
        if not updated:
            return Response({"detail": "Assistant not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
