from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services


class PushView(APIView):
    """POST /api/v1/sync/push: send queued changes. Bad records are returned in `rejected` with a
    reason; the good ones in the same batch are still stored. Replaying a batch changes nothing."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "sync"

    def post(self, request):
        return Response(services.push(request.user, request.data))


class PullView(APIView):
    """GET /api/v1/sync/pull?cursor=c_000042&limit=500: changes since the cursor, oldest first.
    A fresh phone starts from cursor=0. Add excludeDevice=<deviceId> to skip your own pushes."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "sync"

    def get(self, request):
        raw_limit = request.query_params.get("limit", "500")
        try:
            limit = int(raw_limit)
        except ValueError:
            raise ValidationError({"limit": "limit must be a whole number."})
        if not 1 <= limit <= 1000:
            raise ValidationError({"limit": "limit must be between 1 and 1000."})
        return Response(
            services.pull(request.user, request.query_params.get("cursor"), limit, request.query_params.get("excludeDevice"))
        )
