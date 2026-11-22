"""Who may record a sale.

Staff record sales; the owner manages products and stock. An owner working
alone (no active staff) still records their own sales, and a sale the owner
made before the rule began, or while they had no staff, is still accepted
when it syncs late, so nothing already recorded is lost.
"""

from datetime import datetime

from django.conf import settings
from django.utils.dateparse import parse_datetime

OWNER_SALE_REFUSED = "Only staff record sales. The owner manages products and stock."


def owner_has_staff(owner) -> bool:
    from .models import Membership

    return Membership.objects.filter(
        shop__owner=owner, role=Membership.Role.ASSISTANT, is_active=True, user__is_active=True
    ).exists()


def owner_may_record_sale(owner, recorded_at: datetime | None = None) -> bool:
    if not owner_has_staff(owner):
        return True
    starts = parse_datetime(settings.SALES_BY_STAFF_ONLY_FROM)
    return recorded_at is not None and starts is not None and recorded_at < starts
