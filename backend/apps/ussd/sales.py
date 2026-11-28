"""Writing a sale from USSD into the tables the phone syncs with.

Each write is also logged as a SyncChange, so it reaches the owner's phone at
the next pull, in the same shape the phone pushes.
"""
import uuid

from django.db import transaction
from django.utils import timezone

from apps.sync.models import MobileMoneyTxn, Payment, Sale, SyncChange


def record_sale(shop, user, amount, method, *, provider="", reference="", at=None):
    """One amount-only sale with a single payment. Returns the Sale.

    A mobile money sale is left unresolved: the phone pairs it with the
    payment message, or with the confirmed request written by
    ``record_confirmed_payment``.
    """
    now = at or timezone.now()
    sale = Sale.objects.create(
        id=f"sale_{uuid.uuid4().hex}",
        shop=shop,
        recorded_by=user,
        subtotal=amount,
        discount_total=0,
        total=amount,
        status=Sale.Status.ACTIVE,
        reconcile_status=Sale.Reconcile.UNRESOLVED,
        created_at=now,
        updated_at=now,
    )
    payment = Payment.objects.create(
        id=f"pay_{uuid.uuid4().hex}",
        shop=shop,
        sale=sale,
        method=method,
        provider=provider,
        amount=amount,
        mobile_money_reference=reference,
        created_at=now,
        updated_at=now,
    )
    payment_payload = {
        "id": payment.id,
        "saleId": sale.id,
        "method": payment.method,
        "amount": payment.amount,
        "createdAt": now.isoformat(),
        "updatedAt": now.isoformat(),
    }
    if provider:
        payment_payload["provider"] = provider
    if reference:
        payment_payload["mobileMoneyReference"] = reference
    SyncChange.objects.create(
        shop=shop,
        entity="sale",
        entity_id=sale.id,
        operation="create",
        payload={
            "sale": {
                "id": sale.id,
                "recordedBy": str(user.id),
                "subtotal": sale.subtotal,
                "discountTotal": sale.discount_total,
                "total": sale.total,
                "status": sale.status,
                "reconcileStatus": sale.reconcile_status,
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
            },
            "lines": [],
            "payments": [payment_payload],
            "stockMovements": [],
        },
        client_created_at=now,
    )
    from apps.smartinvoice.services import send_sale

    transaction.on_commit(lambda: send_sale(sale))
    return sale


def record_confirmed_payment(shop, *, provider, amount, reference, sender, at, note):
    """File a provider-confirmed payment as received, like the app does after a
    request to pay: the phone then matches the sale on its reference at once,
    and the real payment message for the same reference is refused as a
    duplicate instead of showing as money without a sale."""
    now = timezone.now()
    txn = MobileMoneyTxn.objects.create(
        id=f"mm_{uuid.uuid4().hex}",
        shop=shop,
        provider=provider,
        amount=amount,
        sender=sender[:15],
        reference=reference[:60],
        received_at=at,
        raw_message=note,
        parsed=True,
        status=MobileMoneyTxn.Status.UNMATCHED,
        created_at=now,
        updated_at=now,
    )
    SyncChange.objects.create(
        shop=shop,
        entity="mobile_money_txn",
        entity_id=txn.id,
        operation="create",
        payload={
            "id": txn.id,
            "provider": txn.provider,
            "amount": txn.amount,
            "sender": txn.sender,
            "reference": txn.reference,
            "receivedAt": at.isoformat(),
            "rawMessage": note,
            "parsed": True,
            "status": txn.status,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        },
        client_created_at=now,
    )
    return txn
