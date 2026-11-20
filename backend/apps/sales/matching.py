"""Money matching: pair mobile-money sales with provider payments.

The rule is deliberately identical to ``mobile/src/core/reconcile.ts``:

1. the amount is identical;
2. the provider is identical when both sides record one;
3. the two times are within the configured window (30 minutes by default);
4. the references agree, or neither side has one. A one-sided reference is
   never enough.

Ambiguity is judged from both sides: a sale that fits two payments and a
payment that fits two sales are both left unmatched for a human. A match is
stored as a pair and is not re-decided later; a void releases it.
"""
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction

from apps.ledger.services import verify_sale_entry

from .models import MobilePayment, Sale


@dataclass(frozen=True)
class MatchCandidate:
    id: str
    amount: object
    reference: str
    provider: str
    at: datetime


@dataclass(frozen=True)
class MatchResult:
    matched: list[tuple[str, str]]
    unmatched_sales: list[str]
    unmatched_received: list[str]
    ambiguous_sales: list[str]
    ambiguous_received: list[str]


def normalise_reference(reference: str | None) -> str:
    return "".join((reference or "").upper().split())


def _minutes_between(a: datetime, b: datetime) -> float:
    return abs((a - b).total_seconds()) / 60


def fits_sale(sale: MatchCandidate, payment: MatchCandidate, window_minutes: int) -> bool:
    if sale.amount != payment.amount:
        return False
    if sale.provider and payment.provider and sale.provider != payment.provider:
        return False
    if _minutes_between(sale.at, payment.at) > window_minutes:
        return False

    sale_ref = normalise_reference(sale.reference)
    payment_ref = normalise_reference(payment.reference)
    if sale_ref and payment_ref:
        return sale_ref == payment_ref
    # Only one side has a reference: not enough to say these are the same payment.
    return not sale_ref and not payment_ref


def match_candidates(
    sales: list[MatchCandidate], received: list[MatchCandidate], window_minutes: int
) -> MatchResult:
    used: set[str] = set()
    matched: list[tuple[str, str]] = []
    unmatched_sales: list[str] = []
    ambiguous_sales: list[str] = []

    ordered = sorted(sales, key=lambda sale: sale.at)
    fits = {
        sale.id: [
            payment for payment in received if fits_sale(sale, payment, window_minutes)
        ]
        for sale in ordered
    }
    sales_per_payment = Counter(
        payment.id for candidates in fits.values() for payment in candidates
    )

    for sale in ordered:
        candidates = fits.get(sale.id, [])
        if not candidates:
            unmatched_sales.append(sale.id)
        elif len(candidates) == 1 and sales_per_payment[candidates[0].id] == 1:
            used.add(candidates[0].id)
            matched.append((sale.id, candidates[0].id))
        else:
            ambiguous_sales.append(sale.id)

    ambiguous_received = [
        payment.id for payment in received if sales_per_payment[payment.id] > 1
    ]
    return MatchResult(
        matched=matched,
        unmatched_sales=unmatched_sales,
        unmatched_received=[
            payment.id for payment in received if payment.id not in used
        ],
        ambiguous_sales=ambiguous_sales,
        ambiguous_received=ambiguous_received,
    )


def _window() -> timedelta:
    return timedelta(minutes=settings.PAYMENT_MATCH_WINDOW_MINUTES)


def _candidate(sale: Sale) -> MatchCandidate:
    return MatchCandidate(
        id=str(sale.id),
        amount=sale.total,
        reference=sale.payment_reference,
        provider=sale.provider,
        at=sale.sold_at,
    )


def _payment_candidate(payment: MobilePayment) -> MatchCandidate:
    return MatchCandidate(
        id=str(payment.id),
        amount=payment.amount,
        reference=payment.provider_ref,
        provider=payment.provider,
        at=payment.received_at,
    )


@transaction.atomic
def link(sale: Sale, payment: MobilePayment) -> None:
    payment.sale = sale
    payment.status = MobilePayment.Status.MATCHED
    payment.save(update_fields=["sale", "status", "updated_at"])
    sale.match_status = Sale.Match.MATCHED
    sale.save(update_fields=["match_status", "updated_at"])
    verify_sale_entry(sale)


def _mark_review(result: MatchResult) -> None:
    if result.ambiguous_sales:
        Sale.objects.filter(id__in=result.ambiguous_sales).update(
            match_status=Sale.Match.NEEDS_REVIEW
        )
    if result.ambiguous_received:
        MobilePayment.objects.filter(id__in=result.ambiguous_received).update(
            status=MobilePayment.Status.NEEDS_REVIEW
        )


@transaction.atomic
def try_match_sale(sale: Sale) -> MobilePayment | None:
    if (
        sale.payment_method != Sale.Method.MOBILE_MONEY
        or sale.match_status != Sale.Match.PENDING
    ):
        return None

    window = _window()
    payments = list(
        MobilePayment.objects.select_for_update().filter(
            shop=sale.shop,
            status=MobilePayment.Status.UNMATCHED,
            amount=sale.total,
            received_at__gte=sale.sold_at - window,
            received_at__lte=sale.sold_at + window,
        )
    )
    if not payments:
        return None

    # Judge ambiguity from the payment side too: there may be another sale that
    # fits the same payment. Fetch the sales around each candidate payment.
    sale_ids = {sale.id}
    for payment in payments:
        for other in Sale.objects.filter(
            shop=sale.shop,
            payment_method=Sale.Method.MOBILE_MONEY,
            status=Sale.Status.RECORDED,
            match_status=Sale.Match.PENDING,
            total=payment.amount,
            sold_at__gte=payment.received_at - window,
            sold_at__lte=payment.received_at + window,
        ):
            sale_ids.add(other.id)
    sale_qs = Sale.objects.select_for_update().filter(id__in=sale_ids)

    result = match_candidates(
        [_candidate(row) for row in sale_qs],
        [_payment_candidate(row) for row in payments],
        settings.PAYMENT_MATCH_WINDOW_MINUTES,
    )
    _mark_review(result)
    for sale_id, payment_id in result.matched:
        if str(sale_id) == str(sale.id):
            payment = next(row for row in payments if str(row.id) == str(payment_id))
            link(sale, payment)
            return payment
    return None


@transaction.atomic
def try_match_payment(payment: MobilePayment) -> Sale | None:
    if payment.status != MobilePayment.Status.UNMATCHED:
        return None

    window = _window()
    sales = list(
        Sale.objects.select_for_update().filter(
            shop=payment.shop,
            payment_method=Sale.Method.MOBILE_MONEY,
            status=Sale.Status.RECORDED,
            match_status=Sale.Match.PENDING,
            total=payment.amount,
            sold_at__gte=payment.received_at - window,
            sold_at__lte=payment.received_at + window,
        )
    )
    if not sales:
        return None

    # Judge ambiguity from the sale side too: another payment may fit the same sale.
    payment_ids = {payment.id}
    for sale in sales:
        for other in MobilePayment.objects.filter(
            shop=payment.shop,
            status=MobilePayment.Status.UNMATCHED,
            amount=sale.total,
            received_at__gte=sale.sold_at - window,
            received_at__lte=sale.sold_at + window,
        ):
            payment_ids.add(other.id)
    payment_qs = MobilePayment.objects.select_for_update().filter(id__in=payment_ids)

    result = match_candidates(
        [_candidate(row) for row in sales],
        [_payment_candidate(row) for row in payment_qs],
        settings.PAYMENT_MATCH_WINDOW_MINUTES,
    )
    _mark_review(result)
    for sale_id, payment_id in result.matched:
        if str(payment_id) == str(payment.id):
            sale = next(row for row in sales if str(row.id) == str(sale_id))
            link(sale, payment)
            return sale
    return None
