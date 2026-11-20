from django.db.models import F
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.shop_scope import ShopScopedMixin
from apps.integrations.ai import get_invoice_reader

from . import services
from .models import InvoiceScan, Item, StockMovement, StockTake, StockTakeLine
from .serializers import (
    AdjustSerializer, BulkItemSerializer, InvoiceConfirmSerializer, InvoiceScanSerializer,
    ItemBriefSerializer, ItemSerializer, ReceiveSerializer, StockMovementSerializer,
    StockTakeCloseSerializer, StockTakeLineSerializer, StockTakeScanSerializer, StockTakeSerializer,
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ItemViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    """Stock register. Owners manage items; assistants can look items up, sell and receive deliveries."""

    queryset = Item.objects.all()
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    owner_actions = {"create", "update", "partial_update", "destroy", "bulk", "adjust"}
    search_fields = ["name", "color", "size", "label_code", "barcode", "category"]
    ordering_fields = ["name", "price", "quantity", "created_at"]

    def get_serializer_class(self):
        # Assistants never see cost prices.
        if self.membership and self.membership.role != "owner":
            return ItemBriefSerializer
        return ItemSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        if p.get("category"):
            qs = qs.filter(category__iexact=p["category"])
        if p.get("low_stock") == "1":
            qs = qs.filter(quantity__lte=F("reorder_level"))
        return qs

    def perform_create(self, serializer):
        qty = serializer.validated_data.pop("initial_quantity", 0)
        item = serializer.save(shop=self.shop)
        if qty:
            services.apply_movement(
                item_id=item.id, change=qty, kind=StockMovement.Kind.OPENING, user=self.request.user
            )
            item.refresh_from_db()
            serializer.instance = item

    def perform_destroy(self, instance):
        instance.is_active = False  # keep history; sold items must stay referenceable
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Scan a label or barcode: GET /items/lookup/?code=SS1-AB12CD"""
        item = services.find_item_by_code(self.shop, request.query_params.get("code"))
        if not item:
            raise NotFound("No item with this code in your shop.")
        return Response(self.get_serializer(item).data)

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        s = BulkItemSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        kind = StockMovement.Kind.OPENING if d["kind"] == "opening" else StockMovement.Kind.DELIVERY
        items = services.bulk_create_items(
            shop=self.shop, user=request.user, name=d["name"], category=d["category"], color=d["color"],
            price=d["price"], cost_price=d.get("cost_price"), sizes=d["sizes"],
            quantity_each=d["quantity_each"], kind=kind,
        )
        return Response(ItemSerializer(items, many=True).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        """New delivery: owner or assistant adds received quantity."""
        item = self.get_object()
        s = ReceiveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.apply_movement(
            item_id=item.id, change=s.validated_data["quantity"], kind=StockMovement.Kind.DELIVERY,
            user=request.user, reference=s.validated_data["reference"],
        )
        item.refresh_from_db()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        """Owner-only manual correction (always needs a reason)."""
        item = self.get_object()
        s = AdjustSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.apply_movement(
            item_id=item.id, change=s.validated_data["quantity_change"],
            kind=StockMovement.Kind.ADJUSTMENT, user=request.user, note=s.validated_data["note"],
        )
        item.refresh_from_db()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["get"])
    def movements(self, request, pk=None):
        item = self.get_object()
        page = self.paginate_queryset(item.movements.all())
        return self.get_paginated_response(StockMovementSerializer(page, many=True).data)

    @action(detail=True, methods=["get"])
    def label(self, request, pk=None):
        """Everything the app needs to render/print a QR or barcode label."""
        item = self.get_object()
        return Response({
            "label_code": item.label_code, "qr_payload": item.label_code,
            "title": item.name, "subtitle": " ".join(p for p in (item.color, item.size) if p),
            "price": str(item.price),
        })


class InvoiceScanViewSet(ShopScopedMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                         mixins.ListModelMixin, viewsets.GenericViewSet):
    """Photo of a supplier invoice -> suggested stock lines -> user confirms."""

    queryset = InvoiceScan.objects.all()
    serializer_class = InvoiceScanSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def create(self, request, *args, **kwargs):
        image = request.FILES.get("image")
        if not image:
            raise ValidationError({"image": "Upload a photo of the invoice."})
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise ValidationError({"image": "Use a JPEG, PNG or WebP photo."})
        if image.size > MAX_IMAGE_BYTES:
            raise ValidationError({"image": "Photo is too large (max 8 MB)."})
        scan = InvoiceScan.objects.create(shop=self.shop, image=image, created_by=request.user)
        try:
            scan.image.open("rb")
            data = scan.image.read()
            scan.image.close()
            scan.parsed_items = get_invoice_reader().read(data, image.content_type)
        except Exception as exc:
            scan.status = InvoiceScan.Status.FAILED
            scan.error = str(exc)[:250]
        scan.save()
        return Response(InvoiceScanSerializer(scan, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Send the (possibly corrected) rows. New items need a selling `price`."""
        scan = self.get_object()
        s = InvoiceConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        results = services.confirm_invoice(scan=scan, rows=s.validated_data["items"], user=request.user)
        return Response({"status": scan.status, "results": results})


class StockTakeViewSet(ShopScopedMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                       mixins.ListModelMixin, viewsets.GenericViewSet):
    """Count the shelves; the report says exactly which items are missing."""

    queryset = StockTake.objects.all()
    serializer_class = StockTakeSerializer

    def create(self, request, *args, **kwargs):
        take = services.start_stock_take(shop=self.shop, user=request.user, note=request.data.get("note", ""))
        return Response(StockTakeSerializer(take).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def lines(self, request, pk=None):
        take = self.get_object()
        qs = take.lines.select_related("item").order_by("item__name", "item__size")
        if request.query_params.get("uncounted") == "1":
            qs = qs.filter(counted_qty__isnull=True)
        return Response(StockTakeLineSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"])
    def count(self, request, pk=None):
        """Scan: {"code": "SS1-AB12CD"} adds 1 (or `quantity`). Manual: {"item_id": 5, "counted_qty": 3} sets it."""
        take = self.get_object()
        services.require_open(take)
        s = StockTakeScanSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if d.get("code"):
            item = services.find_item_by_code(self.shop, d["code"])
            if not item:
                raise NotFound("No item with this code in your shop.")
        else:
            item = Item.objects.filter(shop=self.shop, pk=d["item_id"]).first()
            if not item:
                raise NotFound("Item not found.")
        line = StockTakeLine.objects.filter(stock_take=take, item=item).first()
        if line is None:  # item added after the count started
            line = StockTakeLine.objects.create(stock_take=take, item=item, expected_qty=item.quantity)
        if "counted_qty" in d:
            line.counted_qty = d["counted_qty"]
        else:
            line.counted_qty = (line.counted_qty or 0) + d["quantity"]
        line.save(update_fields=["counted_qty"])
        return Response(StockTakeLineSerializer(line).data)

    @action(detail=True, methods=["get"])
    def report(self, request, pk=None):
        take = self.get_object()
        return Response({"stock_take": StockTakeSerializer(take).data, **services.build_report(take)})

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Close the count. Only the owner may also correct the stock levels."""
        take = self.get_object()
        s = StockTakeCloseSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        apply_adj = s.validated_data["apply_adjustments"]
        if apply_adj and self.membership.role != "owner":
            raise ValidationError({"apply_adjustments": "Only the owner can correct stock levels."})
        report = services.close_stock_take(take=take, user=request.user, apply_adjustments=apply_adj)
        return Response({"stock_take": StockTakeSerializer(take).data, **report})
