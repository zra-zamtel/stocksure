import re
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone
from rest_framework.exceptions import ValidationError

TWO_PLACES = Decimal("0.01")


def money(value) -> Decimal:
    """Round to 2 decimal places (ngwee), half up."""
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def normalize_phone(raw: str) -> str:
    """Normalise Zambian numbers to 260XXXXXXXXX (digits only).

    0977123456 -> 260977123456, +260 977 123 456 -> 260977123456, 977123456 -> 260977123456
    """
    digits = re.sub(r"\D", "", raw or "")
    digits = digits.removeprefix("00")
    if digits.startswith("0") and len(digits) == 10:
        digits = "260" + digits[1:]
    elif len(digits) == 9:
        digits = "260" + digits
    return digits


def validate_zm_phone(raw: str) -> str:
    phone = normalize_phone(raw)
    if not re.fullmatch(r"260\d{9}", phone):
        raise ValidationError("Enter a valid Zambian phone number, e.g. 0977123456.")
    return phone


def local_today() -> date:
    return timezone.localdate()


def local_date(dt: datetime) -> date:
    return timezone.localtime(dt).date()


def month_bounds(year: int, month: int):
    start = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


def parse_month(value: str):
    """'2026-11' -> (first_day, last_day)."""
    try:
        y, m = value.split("-")
        return month_bounds(int(y), int(m))
    except (ValueError, AttributeError):
        raise ValidationError({"month": "Use the format YYYY-MM, e.g. 2026-11."})


def parse_date(value, field="date"):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValidationError({field: "Use the format YYYY-MM-DD."})


def iso_now() -> str:
    """Current time as the ISO string the app uses (UTC, milliseconds, trailing Z)."""
    return timezone.now().astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
