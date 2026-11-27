from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.sync.services import is_owner, resolve_shop

from . import services
from .models import TradingRecord


def _owner_shop(request, shop_id):
    # The shop comes from the phone's X-Shop-ID (or shopId), never .first():
    # an owner can have more than one sync shop.
    shop_id = shop_id or request.headers.get("X-Shop-ID")
    if not shop_id:
        return None, Response({"code": "shop_required", "detail": "Send shopId."}, status=400)
    shop = resolve_shop(request.user, shop_id)
    if shop is None:
        return None, Response({"code": "shop_not_found", "detail": "Sync the shop first."}, status=404)
    if not is_owner(request.user, shop):
        return None, Response(
            {"code": "forbidden", "detail": "Only the shop owner can share a trading record."}, status=403
        )
    return shop, None


def _flag(value) -> bool:
    return value is True or str(value).lower() in ("true", "1")


class TradingRecordListView(APIView):
    """GET  /api/v1/trading-records/?shopId=...   the owner's records (no links)
    POST /api/v1/trading-records/                 {shopId, months, expiresInDays, includeMargin, includeTax}

    The response to POST is the only time the share link is returned.
    """

    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "trading-record"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get(self, request):
        shop, refused = _owner_shop(request, request.query_params.get("shopId"))
        if refused:
            return refused
        records = TradingRecord.objects.filter(shop=shop)[:50]
        return Response({"records": [services.owner_view(r) for r in records]})

    def post(self, request):
        shop, refused = _owner_shop(request, request.data.get("shopId"))
        if refused:
            return refused
        try:
            months = int(request.data.get("months", 6))
            expiry_days = int(request.data.get("expiresInDays", 14))
            record, token = services.issue(
                shop,
                request.user,
                months=months,
                expiry_days=expiry_days,
                include_margin=_flag(request.data.get("includeMargin", False)),
                include_tax=_flag(request.data.get("includeTax", False)),
            )
        except (TypeError, ValueError):
            return Response(
                {"code": "validation", "detail": "months and expiresInDays must be numbers."}, status=400
            )
        except services.TradingRecordError as exc:
            return Response({"code": "validation", "detail": str(exc)}, status=400)
        url = services.verify_url(request, token)
        return Response(
            {**services.owner_view(record), "token": token, "verifyUrl": url, "qrSvg": services.qr_svg_data_uri(url)},
            status=status.HTTP_201_CREATED,
        )


class TradingRecordRevokeView(APIView):
    """POST /api/v1/trading-records/<id>/revoke"""

    permission_classes = [IsAuthenticated]

    def post(self, request, record_id):
        record = TradingRecord.objects.select_related("shop").filter(id=record_id).first()
        if record is None or not is_owner(request.user, record.shop):
            return Response({"code": "not_found", "detail": "Unknown trading record."}, status=404)
        if record.revoked_at is None:
            record.revoked_at = timezone.now()
            record.save(update_fields=["revoked_at"])
        return Response(services.owner_view(record))


# ---- public verification ---------------------------------------------------------
#
# Anyone with the link (a bank officer scanning the QR) can open these. A link
# that is unknown, expired or revoked shows no figures at all.


def _public(record, token):
    if record is None:
        return {"status": "not_found"}, 404
    state = record.state()
    if state != "valid":
        return {
            "status": state,
            "issuedAt": services._iso(record.issued_at),
            "expiresAt": services._iso(record.expires_at),
            "revokedAt": services._iso(record.revoked_at),
        }, 410
    if not services.intact(record):
        return {"status": "tampered"}, 409
    services.note_view(record)
    return {
        "status": "valid",
        "seal": services.seal_code(record.payload_hash),
        "payloadHash": record.payload_hash,
        "hashAlgorithm": "SHA-256 over canonical JSON (sorted keys, no spaces, UTF-8)",
        "payload": record.payload,
    }, 200


@never_cache
@require_GET
def verify_page(request, token):
    body, code = _public(services.find(token), token)
    payload = body.get("payload") or {}
    return render(
        request,
        "trading_record/verify.html",
        {"result": body, "p": payload, "json_url": f"/verify/{token}/json/"},
        status=code,
    )


@never_cache
@require_GET
def verify_json(request, token):
    body, code = _public(services.find(token), token)
    return JsonResponse(body, status=code, json_dumps_params={"ensure_ascii": False})
