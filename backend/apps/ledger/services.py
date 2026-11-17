"""Ledger rules.

A sale-derived entry starts as ``trader_reported`` and is upgraded to ``verified`` only when the
money side is independently confirmed:
  * mobile money -> the sale matched a real (or simulated) Zamtel payment
  * cash         -> the day was closed with no gap (within the shop's tolerance)
Anything typed in by hand is always ``trader_reported``.
"""
from .models import LedgerEntry

V = LedgerEntry.Verification


def create_sale_entry(sale, user=None):
    return LedgerEntry.objects.create(
        shop=sale.shop,
        entry_type=LedgerEntry.Type.INCOME,
        category=LedgerEntry.Category.SALES,
        amount=sale.total,
        description=f"Sale #{sale.id} ({sale.get_payment_method_display()})",
        entry_date=sale.sale_date,
        source=LedgerEntry.Source.SALE,
        verification=V.TRADER_REPORTED,
        sale=sale,
        created_by=user,
    )


def verify_sale_entry(sale):
    """Called when a mobile-money sale is matched to a payment."""
    LedgerEntry.objects.filter(sale=sale, is_void=False).update(verification=V.VERIFIED)


def void_sale_entry(sale):
    LedgerEntry.objects.filter(sale=sale).update(is_void=True, verification=V.TRADER_REPORTED)


def verify_cash_sales(shop, date):
    LedgerEntry.objects.filter(
        shop=shop, entry_date=date, source=LedgerEntry.Source.SALE, is_void=False,
        sale__payment_method="cash",
    ).update(verification=V.VERIFIED)


def unverify_cash_sales(shop, date):
    LedgerEntry.objects.filter(
        shop=shop, entry_date=date, source=LedgerEntry.Source.SALE, sale__payment_method="cash",
    ).update(verification=V.TRADER_REPORTED)
