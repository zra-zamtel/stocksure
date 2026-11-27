import logging

from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import SyncChange
from .services import SyncError, apply_change, cursor_value, pull_changes, user_shops

logger = logging.getLogger(__name__)

MAX_CHANGES = 500


class SyncPushView(APIView):
    """POST /api/v1/sync/push

    The phone sends its outbox. Every change is applied on its own and a bad row
    is returned in ``rejected`` with a reason; the server never repairs it.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "sync-push"

    def post(self, request):
        changes = request.data.get("changes")
        if not isinstance(changes, list) or not changes:
            return Response(
                {"detail": "Send a non-empty list of changes."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(changes) > MAX_CHANGES:
            return Response(
                {"detail": f"Send at most {MAX_CHANGES} changes per batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The phone's own shop: every row in the batch must land there.
        shop_id = request.headers.get("X-Shop-ID") or request.query_params.get("shop")
        accepted = []
        rejected = []
        for change in changes:
            queue_id = change.get("queueId") if isinstance(change, dict) else None
            if not queue_id or not isinstance(queue_id, str):
                rejected.append({"queueId": queue_id, "reason": "queueId is required."})
                continue
            try:
                apply_change(change, request.user, queue_id, shop_id=shop_id)
                accepted.append(queue_id)
            except SyncError as exc:
                rejected.append({"queueId": queue_id, "reason": str(exc)})
            except IntegrityError:
                rejected.append(
                    {
                        "queueId": queue_id,
                        "reason": "That row conflicts with an existing unique value (barcode or day).",
                    }
                )
            except Exception:
                logger.exception("Sync change %s failed", queue_id)
                rejected.append(
                    {"queueId": queue_id, "reason": "The server could not store this change."}
                )

        latest = SyncChange.objects.filter(shop__in=user_shops(request.user)).order_by("-id").first()
        return Response(
            {
                "accepted": accepted,
                "rejected": rejected,
                "serverTime": timezone.now().isoformat(),
                "cursor": str(latest.id) if latest else "0",
            },
            status=status.HTTP_200_OK,
        )


class SyncPullView(APIView):
    """GET /api/v1/sync/pull?cursor=...&limit=...

    Returns the changes after the cursor that belong to the caller's shops.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "sync-pull"

    def get(self, request):
        try:
            cursor = cursor_value(request.query_params.get("cursor", "0"))
            limit = int(request.query_params.get("limit", "500"))
        except (SyncError, TypeError, ValueError):
            return Response(
                {"detail": "cursor and limit must be numbers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        limit = max(1, min(limit, 500))
        shop_id = request.headers.get("X-Shop-ID") or request.query_params.get("shop")

        changes, next_cursor = pull_changes(
            request.user, cursor, limit, shop_id=shop_id
        )
        return Response(
            {
                "changes": changes,
                "nextCursor": next_cursor,
                "serverTime": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )
