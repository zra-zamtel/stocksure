"""Money matching: pair mobile-money sales with Zamtel payments.

A sale and a payment match when they are in the same shop, for the same amount, within
PAYMENT_MATCH_WINDOW_MINUTES of each other (the payer's phone is used to break ties).
Matching works in both orders because the payment SMS can arrive before or after the assistant
records the sale.
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction

from apps.ledger.services import verify_sale_entry

from .models import MobilePayment, Sale


def _window():
    return timedelta(minutes=settings.PAYMENT_MATCH_WINDOW_MINUTES)


@transaction.atomic
def link(sale, payment):
    payment.sale = sale
    payment.status = MobilePayment.Status.MATCHED
    payment.save(update_fields=["sale", "status", "updated_at"])
    sale.match_status = Sale.Match.MATCHED
    sale.save(update_fields=["match_status", "updated_at"])
    verify_sale_entry(sale)


@transaction.atomic
def try_match_sale(sale):
    if sale.payment_method != Sale.Method.MOBILE_MONEY or sale.match_status == Sale.Match.MATCHED:
        return None
    qs = MobilePayment.objects.select_for_update().filter(
        shop=sale.shop, status=MobilePayment.Status.UNMATCHED, amount=sale.total,
        received_at__gte=sale.sold_at - _window(), received_at__lte=sale.sold_at + _window(),
    ).order_by("received_at")
    payment = None
    if sale.payer_phone:
        payment = qs.filter(payer_phone=sale.payer_phone).first()
    payment = payment or qs.first()
    if payment:
        link(sale, payment)
    return payment


@transaction.atomic
def try_match_payment(payment):
    if payment.status == MobilePayment.Status.MATCHED:
        return None
    qs = Sale.objects.select_for_update().filter(
        shop=payment.shop, payment_method=Sale.Method.MOBILE_MONEY, status=Sale.Status.RECORDED,
        match_status=Sale.Match.PENDING, total=payment.amount,
        sold_at__gte=payment.received_at - _window(), sold_at__lte=payment.received_at + _window(),
    ).order_by("sold_at")
    sale = None
    if payment.payer_phone:
        sale = qs.filter(payer_phone=payment.payer_phone).first()
    sale = sale or qs.first()
    if sale:
        link(sale, payment)
    return sale
