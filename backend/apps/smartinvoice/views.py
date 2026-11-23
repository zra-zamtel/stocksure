from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.sync.models import Sale
from apps.sync.services import is_owner, resolve_shop

from .models import SmartInvoiceReceipt
from .services import SmartInvoiceError, connect, phone_payload, status_for


def _owner_shop(request, shop_id):
    shop = resolve_shop(request.user, shop_id)
    if shop is None:
        return None, Response({"code": "shop_not_found", "detail": "Sync the shop first."}, status=404)
    if not is_owner(request.user, shop):
        return None, Response(
            {"code": "forbidden", "detail": "Only the shop owner can manage Smart Invoice."}, status=403
        )
    return shop, None


class SmartInvoiceStatusView(APIView):
    """GET /api/v1/smart-invoice/status?shopId=..."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        shop, refused = _owner_shop(request, request.query_params.get("shopId"))
        if refused:
            return refused
        return Response(status_for(shop))


class SmartInvoiceConnectView(APIView):
    """POST /api/v1/smart-invoice/connect {shopId, tpin}

    The one step a trader takes. StockSure registers the device and sends
    every sale so far.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        shop, refused = _owner_shop(request, request.data.get("shopId"))
        if refused:
            return refused
        try:
            connect(shop, str(request.data.get("tpin", "")))
        except SmartInvoiceError as exc:
            return Response({"code": "invalid_tpin", "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status_for(shop), status=status.HTTP_200_OK)


class SmartInvoiceSaleView(APIView):
    """GET /api/v1/smart-invoice/sales/<saleId>

    The receipts for one sale plus the exact request sent to the VSDC, so the
    owner (or a ZRA reviewer) can see what was declared.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, sale_id: str):
        sale = Sale.objects.select_related("shop").filter(id=sale_id).first()
        if sale is None:
            return Response({"code": "not_found", "detail": "Unknown sale."}, status=404)
        _shop, refused = _owner_shop(request, sale.shop_id)
        if refused:
            return refused
        receipts = SmartInvoiceReceipt.objects.filter(sale=sale).order_by("created_at")
        return Response(
            {"receipts": [{**phone_payload(r), "request": r.request} for r in receipts]}
        )
