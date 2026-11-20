from rest_framework import serializers

from .models import InvoiceScan, Item, StockMovement, StockTake, StockTakeLine


class ItemSerializer(serializers.ModelSerializer):
    initial_quantity = serializers.IntegerField(write_only=True, required=False, min_value=0, default=0)
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Item
        fields = [
            "id", "name", "display_name", "category", "size", "color", "barcode", "label_code",
            "price", "cost_price", "quantity", "reorder_level", "photo", "is_active", "initial_quantity",
        ]
        read_only_fields = ["id", "label_code", "quantity", "display_name"]
        extra_kwargs = {"barcode": {"required": False, "allow_blank": True}}

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be more than zero.")
        return value

    def validate_barcode(self, value):
        shop = self.context.get("shop")
        if value and shop:
            qs = Item.objects.filter(shop=shop, barcode=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("Another item in this shop already uses this barcode.")
        return value


class ItemBriefSerializer(serializers.ModelSerializer):
    """What the assistant's sales screen needs - no cost price."""

    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Item
        fields = ["id", "name", "display_name", "size", "color", "label_code", "barcode", "price", "quantity", "photo"]


class BulkItemSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    color = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    sizes = serializers.JSONField(help_text="'40-44', '40,42,44' or ['S','M','L']")
    quantity_each = serializers.IntegerField(min_value=0)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    cost_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    kind = serializers.ChoiceField(choices=["opening", "delivery"], default="opening")


class ReceiveSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1)
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")


class AdjustSerializer(serializers.Serializer):
    quantity_change = serializers.IntegerField()
    note = serializers.CharField(max_length=255)

    def validate_quantity_change(self, value):
        if value == 0:
            raise serializers.ValidationError("Change cannot be zero.")
        return value


class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = ["id", "kind", "quantity_change", "balance_after", "reference", "note", "created_at"]


class InvoiceScanSerializer(serializers.ModelSerializer):
    suggestions = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceScan
        fields = ["id", "image", "status", "parsed_items", "suggestions", "error", "created_at", "confirmed_at"]
        read_only_fields = ["id", "status", "parsed_items", "suggestions", "error", "created_at", "confirmed_at"]

    def get_suggestions(self, obj):
        from .services import suggest_match

        out = []
        for row in obj.parsed_items:
            item = suggest_match(obj.shop, row)
            out.append({"existing_item_id": item.id if item else None})
        return out


class InvoiceRowSerializer(serializers.Serializer):
    item_id = serializers.IntegerField(required=False, allow_null=True)
    name = serializers.CharField(max_length=150)
    category = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    size = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    color = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)


class InvoiceConfirmSerializer(serializers.Serializer):
    items = InvoiceRowSerializer(many=True, allow_empty=False)


class StockTakeLineSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.display_name", read_only=True)
    label_code = serializers.CharField(source="item.label_code", read_only=True)
    difference = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockTakeLine
        fields = ["id", "item", "item_name", "label_code", "expected_qty", "counted_qty", "difference"]


class StockTakeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockTake
        fields = ["id", "status", "note", "created_at", "closed_at", "adjustments_applied", "summary"]


class StockTakeScanSerializer(serializers.Serializer):
    code = serializers.CharField(required=False)
    item_id = serializers.IntegerField(required=False)
    quantity = serializers.IntegerField(required=False, min_value=1, default=1)
    counted_qty = serializers.IntegerField(required=False, min_value=0)

    def validate(self, attrs):
        if not attrs.get("code") and not attrs.get("item_id"):
            raise serializers.ValidationError("Send a scanned 'code' or an 'item_id'.")
        return attrs


class StockTakeCloseSerializer(serializers.Serializer):
    apply_adjustments = serializers.BooleanField(default=False)
