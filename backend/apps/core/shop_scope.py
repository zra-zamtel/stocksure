"""Shop scoping + role checks shared by every shop-level endpoint.

A request is tied to one shop. The client sends ``X-Shop-ID`` (or ``?shop=``). If the user only
belongs to one shop (always true for assistants) the header can be left out.

Roles: owner sees everything for the shop; assistant only gets the simple sales screens.
"""
from rest_framework.exceptions import (
    NotAuthenticated,
    PermissionDenied,
    ValidationError,
)
from rest_framework.permissions import BasePermission, IsAuthenticated


def resolve_shop(request):
    from apps.shops.models import Membership

    user = request.user
    if not user or not user.is_authenticated:
        raise NotAuthenticated()

    qs = Membership.objects.select_related("shop").filter(
        user=user, is_active=True, shop__is_active=True
    )
    shop_id = request.headers.get("X-Shop-ID") or request.query_params.get("shop")
    if shop_id:
        try:
            membership = qs.get(shop_id=shop_id)
        except (Membership.DoesNotExist, ValueError, TypeError):
            raise PermissionDenied("You do not belong to this shop.")
    else:
        found = list(qs[:2])
        if not found:
            raise PermissionDenied("You are not a member of any shop.")
        if len(found) > 1:
            raise ValidationError({"shop": "You have several shops: send the X-Shop-ID header."})
        membership = found[0]
    return membership.shop, membership


class ShopRolePermission(BasePermission):
    """Views set ``owner_only = True`` or list restricted actions in ``owner_actions``."""

    message = "This action is only available to the shop owner."

    def has_permission(self, request, view):
        membership = getattr(view, "membership", None)
        if membership is None:
            return False
        if getattr(view, "owner_only", False):
            return membership.role == "owner"
        action = getattr(view, "action", None) or request.method.lower()
        if action in getattr(view, "owner_actions", ()):
            return membership.role == "owner"
        return True


class ShopScopedMixin:
    """Put first in the bases of a ViewSet/APIView. Exposes ``self.shop`` and ``self.membership``."""

    permission_classes = [IsAuthenticated, ShopRolePermission]
    owner_only = False
    owner_actions = ()
    shop = None
    membership = None

    def check_permissions(self, request):
        self.shop, self.membership = resolve_shop(request)
        super().check_permissions(request)

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return qs.none()
        return qs.filter(shop=self.shop)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["shop"] = self.shop
        ctx["membership"] = self.membership
        return ctx
