"""Mobile money over USSD: a request to pay, sent to the customer's wallet.

The staff member picks the network and types the customer's number. The
customer gets the provider's prompt on their own phone and approves it with
their PIN. USSD cannot wait for that, so the session ends once the request is
out, and ``settle`` writes the sale when the provider reports it paid. It runs
whenever someone in the shop dials in, when the owner's phone syncs, and when
the staff member checks their requests.
"""
import hashlib
import logging
import time
import uuid

from django.db import transaction
from django.utils import timezone

from apps.collections.fees import customer_fee_ngwee
from apps.collections.models import PaymentRequest
from apps.collections.providers import ProviderError, get_provider
from apps.collections.serializers import MAX_REQUEST_NGWEE
from apps.collections.views import refresh
from apps.core.utils import normalize_phone
from apps.shops.models import Membership
from apps.sync.models import Payment

from .models import UssdPaymentRequest
from .sales import record_confirmed_payment, record_sale

logger = logging.getLogger(__name__)

NETWORKS = {"1": "MTN", "2": "Airtel", "3": "Zamtel"}
# The network's prefixes after the 260, the same table as the app's request dialog.
PREFIXES = {"MTN": ("96", "76"), "Airtel": ("97", "77", "57"), "Zamtel": ("95", "75")}
SETTLE_LIMIT = 10


def network_for(phone):
    """The network a normalised 260... number belongs to, or None if unknown."""
    prefix = phone[3:5]
    return next((name for name, codes in PREFIXES.items() if prefix in codes), None)


def local(phone):
    """260961234567 -> 0961234567, as people say it."""
    return "0" + phone[3:] if phone.startswith("260") else phone


def customer_number(raw):
    """A valid Zambian mobile number as 260..., or None."""
    phone = normalize_phone(raw)
    return phone if len(phone) == 12 and phone.startswith("260") else None


def fee(amount):
    return customer_fee_ngwee(amount)


def too_large(amount):
    return amount > MAX_REQUEST_NGWEE


def _domain_shop(user):
    membership = (
        Membership.objects.select_related("shop")
        .filter(user=user, is_active=True, shop__is_active=True)
        .first()
    )
    return membership.shop if membership else None


def request_id(session_id, text):
    """Stable for one USSD session, so a gateway retry of the last step finds
    the same request instead of prompting the customer twice."""
    if not session_id:
        return f"rtp_ussd_{uuid.uuid4().hex}"
    digest = hashlib.sha256(f"{session_id}|{text}".encode()).hexdigest()[:40]
    return f"rtp_ussd_{digest}"


def start(user, shop, *, amount, provider, phone, rid):
    """Send the request. Returns the PaymentRequest, or None when the shop has
    no collections set up. A provider refusal comes back as a failed request."""
    existing = PaymentRequest.objects.filter(pk=rid).first()
    if existing:
        return existing
    domain = _domain_shop(user)
    if domain is None:
        return None
    payment = PaymentRequest.objects.create(
        id=rid,
        shop=domain,
        requested_by=user,
        provider=provider,
        phone=phone,
        amount_ngwee=amount,
        fee_ngwee=fee(amount),
    )
    UssdPaymentRequest.objects.create(payment_request=payment, shop=shop, requested_by=user)
    try:
        get_provider().start(payment)
    except Exception as exc:  # noqa: BLE001 - report it on the USSD screen
        logger.warning("USSD request to pay %s could not start: %s", payment.id, exc)
        payment.status = PaymentRequest.Status.FAILED
        payment.reason = (
            str(exc)[:200] if isinstance(exc, ProviderError) else "The payment service could not be reached."
        )
        payment.completed_at = timezone.now()
        payment.save()
    else:
        if payment.provider_reference:
            payment.save(update_fields=["provider_reference", "updated_at"])
    return payment


def settle(link):
    """Ask the provider where the request stands; write the sale once it is paid."""
    payment = refresh(link.payment_request)
    if payment.status != PaymentRequest.Status.SUCCESSFUL or link.sale_id:
        return payment
    with transaction.atomic():
        link = UssdPaymentRequest.objects.select_for_update().get(pk=link.pk)
        if link.sale_id:
            return payment
        at = payment.completed_at
        reference = payment.provider_reference or payment.id
        sale = record_sale(
            link.shop,
            link.requested_by,
            payment.amount_ngwee,
            Payment.Method.MOBILE_MONEY,
            provider=payment.provider,
            reference=reference,
            at=at,
        )
        note = f"Request to pay approved by {local(payment.phone)}. Ref {reference}."
        if payment.fee_ngwee:
            note += f" Customer also paid a K{payment.fee_ngwee / 100:.2f} mobile money fee."
        record_confirmed_payment(
            link.shop,
            provider=payment.provider,
            amount=payment.amount_ngwee,
            reference=reference,
            sender=local(payment.phone),
            at=at,
            note=note,
        )
        link.sale_id = sale.id
        link.save(update_fields=["sale_id"])
    return payment


def settle_pending(shops, *, budget_seconds=5.0, limit=SETTLE_LIMIT):
    """Settle the open USSD requests of these sync shops, oldest first.

    Never raises, and stops starting new provider checks once the time budget
    is spent: it runs in front of a USSD menu (which the gateway gives 10
    seconds) and a sync pull, and neither may fail because a provider is slow.
    """
    deadline = time.monotonic() + budget_seconds
    links = (
        UssdPaymentRequest.objects.select_related("payment_request", "shop", "requested_by")
        .filter(shop__in=shops, sale_id="")
        .exclude(payment_request__status__in=[PaymentRequest.Status.FAILED, PaymentRequest.Status.EXPIRED])
        .order_by("created_at")[:limit]
    )
    for link in links:
        if time.monotonic() > deadline:
            break
        try:
            settle(link)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not settle USSD request %s: %s", link.payment_request_id, exc)
