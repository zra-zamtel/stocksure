"""The mobile money fee passed on to the customer.

The provider takes a percentage of what it collects (Lipila: 2.5%). To leave
the shop with the full sale, the customer is asked for sale / (1 - rate),
rounded up to the ngwee, so rounding never leaves the shop short.
"""
from decimal import ROUND_CEILING, Decimal

from django.conf import settings


def fee_percent() -> Decimal:
    return Decimal(str(settings.COLLECTIONS_CUSTOMER_FEE_PERCENT))


def customer_fee_ngwee(amount_ngwee: int) -> int:
    """The fee added on top of a sale of `amount_ngwee`; 0 when no fee is passed on."""
    rate = fee_percent() / 100
    if rate <= 0:
        return 0
    if rate >= 1:
        raise ValueError("COLLECTIONS_CUSTOMER_FEE_PERCENT must be below 100")
    charged = (Decimal(amount_ngwee) / (1 - rate)).to_integral_value(rounding=ROUND_CEILING)
    return int(charged) - amount_ngwee
