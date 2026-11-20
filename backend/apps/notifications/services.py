from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.integrations.sms import get_sms_backend

from .models import Notification

# Messages must never present an estimate as an official assessment.
ESTIMATE_NOTE = "This is an estimate, not a ZRA assessment."


def notify_owner(shop, kind, message, dedupe_key=""):
    """Create + send an SMS to the shop owner. With a dedupe_key, the same key is sent only once."""
    if dedupe_key and Notification.objects.filter(shop=shop, dedupe_key=dedupe_key).exists():
        return None
    note = Notification.objects.create(
        shop=shop, recipient_phone=shop.owner.phone, kind=kind, message=message, dedupe_key=dedupe_key
    )
    try:
        ok, info = get_sms_backend().send(note.recipient_phone, message)
    except Exception as exc:  # noqa: BLE001 - a gateway failure must never break a sale or a close
        ok, info = False, str(exc)[:250]
    note.status = Notification.Status.SENT if ok else Notification.Status.FAILED
    note.provider_message = info[:255]
    note.save(update_fields=["status", "provider_message", "updated_at"])
    return note


def generate_reminders(shop):
    """Daily job: missing-record, savings and tax-due reminders. Safe to run repeatedly."""
    from apps.reconciliation.models import DailyClose
    from apps.sales.models import Sale
    from apps.taxpot.models import SavingsTarget

    sent = []
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)

    # Missing record: sales were recorded yesterday but the day was never closed.
    if Sale.objects.filter(shop=shop, sale_date=yesterday, status=Sale.Status.RECORDED).exists() and not \
            DailyClose.objects.filter(shop=shop, date=yesterday).exists():
        sent.append(notify_owner(
            shop, Notification.Kind.MISSING_RECORD,
            f"StockSure: {shop.name} - {yesterday:%d %b} was not closed. Count the cash and close the day so your records stay verified.",
            dedupe_key=f"missing-close:{shop.id}:{yesterday}",
        ))

    for target in SavingsTarget.objects.filter(shop=shop, is_active=True):
        saved = target.saved_amount()
        remaining = max(target.target_amount - saved, Decimal(0))
        if remaining <= 0:
            continue
        days_left = (target.due_date - today).days if target.due_date else None
        if days_left is not None and 0 <= days_left <= 7:
            sent.append(notify_owner(
                shop, Notification.Kind.TAX_DUE,
                f"StockSure: {target.name} is due in {days_left} day(s). Set aside K{remaining:.2f} more. {ESTIMATE_NOTE} Confirm dates with ZRA.",
                dedupe_key=f"tax-due:{target.id}:{today}",
            ))
        elif target.approach in (SavingsTarget.Approach.DAILY, SavingsTarget.Approach.WEEKLY):
            sent.append(notify_owner(
                shop, Notification.Kind.SAVINGS_REMINDER,
                f"StockSure: time for your TaxPot saving towards {target.name}. K{remaining:.2f} still to go. You can accept, change or skip.",
                dedupe_key=f"savings:{target.id}:{today}",
            ))
    return [n for n in sent if n]
