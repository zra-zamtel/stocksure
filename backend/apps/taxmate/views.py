from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.shop_scope import ShopScopedMixin
from apps.tax.models import TaxEstimate

from . import services
from .models import ReviewedAnswer, TaxMateQuery
from .serializers import AskSerializer


class AskView(ShopScopedMixin, APIView):
    owner_only = True

    def post(self, request):
        s = AskSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        match, score, payload = services.ask(d["question"], d["language"])
        TaxMateQuery.objects.create(
            shop=self.shop, user=request.user, question=d["question"], language=d["language"],
            matched=match, score=score, answered=payload["answered"],
        )
        return Response(payload)


class TopicsView(ShopScopedMixin, APIView):
    """Suggested questions (reviewed content only), grouped by category."""

    owner_only = True

    def get(self, request):
        qs = ReviewedAnswer.objects.filter(is_reviewed=True)
        if request.query_params.get("category"):
            qs = qs.filter(category=request.query_params["category"])
        return Response([{"id": a.id, "category": a.category, "question": a.question} for a in qs])


class AnswerDetailView(ShopScopedMixin, APIView):
    owner_only = True

    def get(self, request, pk):
        a = ReviewedAnswer.objects.filter(pk=pk, is_reviewed=True).first()
        if not a:
            raise NotFound("No reviewed answer with this id.")
        use_ny = request.query_params.get("language") == "ny" and bool(a.answer_ny)
        return Response({
            "answered": True, "id": a.id, "category": a.category, "question": a.question,
            "answer": a.answer_ny if use_ny else a.answer_en, "language": "ny" if use_ny else "en",
            "official_channel": a.official_channel, "reviewed_on": a.reviewed_on,
            "type": "general guidance, not official tax advice",
        })


class ExplainEstimateView(ShopScopedMixin, APIView):
    owner_only = True

    def get(self, request, pk):
        estimate = TaxEstimate.objects.select_related("rule_set").filter(shop=self.shop, pk=pk).first()
        if not estimate:
            raise NotFound("Estimate not found.")
        return Response(services.explain_estimate(estimate))
