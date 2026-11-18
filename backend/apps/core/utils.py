import re
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework.exceptions import ValidationError

LUSAKA = ZoneInfo("Africa/Lusaka")


def normalize_phone(raw: str) -> str:
    """0977123456 / +260 977 123 456 / 977123456 -> 260977123456"""
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
        raise ValidationError({"phone": "Enter a valid Zambian phone number, e.g. 0977123456."})
    return phone


def validate_pin(pin) -> str:
    if not isinstance(pin, str) or not re.fullmatch(r"\d{4,6}", pin):
        raise ValidationError({"pin": "PIN must be 4 to 6 digits."})
    return pin


def parse_iso(value):
    """ISO 8601 text -> aware datetime, or None if it is not a valid timestamp."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def iso_now() -> str:
    return timezone.now().astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_day(value):
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def lusaka_today() -> date:
    return timezone.now().astimezone(LUSAKA).date()


def day_bounds_utc(start: date, end: date):
    """[start 00:00, end+1 00:00) in Lusaka time, as aware datetimes."""
    lo = datetime.combine(start, time.min, tzinfo=LUSAKA)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=LUSAKA)
    return lo, hi
