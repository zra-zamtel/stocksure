"""What counts as a good config file. A bad or partial file must never be published, so the app
always keeps a working copy."""
import hashlib
import json

from django.core.exceptions import ValidationError

TAX_RULES = "tax_rules"
LANG_EN = "lang_en"
LANG_NY = "lang_ny"
KINDS = (TAX_RULES, LANG_EN, LANG_NY)


def canonical(payload) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def checksum(payload) -> str:
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def validate_tax_rules(payload, version):
    """Same shape as `TaxRules` in mobile/src/core/types.ts."""
    if not isinstance(payload, dict):
        raise ValidationError("Tax rules must be a JSON object.")
    expected = {"version", "rate", "threshold", "periodDays", "dueDaysAfterPeriod", "reminderDaysBefore"}
    missing, extra = expected - set(payload), set(payload) - expected
    if missing:
        raise ValidationError(f"Missing field(s): {', '.join(sorted(missing))}.")
    if extra:
        raise ValidationError(f"Unknown field(s): {', '.join(sorted(extra))}.")
    if payload["version"] != version:
        raise ValidationError("The 'version' inside the rules must equal this record's version number.")
    rate = payload["rate"]
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 < rate < 1:
        raise ValidationError("rate must be a fraction between 0 and 1 (0.04 means 4%).")
    if not _is_int(payload["threshold"]) or payload["threshold"] <= 0:
        raise ValidationError("threshold must be a positive whole number of ngwee.")
    if not _is_int(payload["periodDays"]) or not 1 <= payload["periodDays"] <= 366:
        raise ValidationError("periodDays must be a whole number from 1 to 366.")
    if not _is_int(payload["dueDaysAfterPeriod"]) or not 0 <= payload["dueDaysAfterPeriod"] <= 366:
        raise ValidationError("dueDaysAfterPeriod must be a whole number from 0 to 366.")
    days = payload["reminderDaysBefore"]
    if not isinstance(days, list) or not days or not all(_is_int(d) and 0 <= d <= 366 for d in days):
        raise ValidationError("reminderDaysBefore must be a non-empty list of whole numbers (0 = on the due date).")


def validate_language(payload, previous_keys=None):
    """A flat {"key": "text"} file, like mobile/src/i18n/en.json. A new version may add keys but never
    drop them, which also rejects a file that was cut off part-way."""
    if not isinstance(payload, dict) or not payload:
        raise ValidationError("A language file must be a non-empty JSON object of key: text.")
    bad = [k for k, v in payload.items() if not isinstance(k, str) or not isinstance(v, str)]
    if bad:
        raise ValidationError(f"Every value must be text. Check: {', '.join(map(str, bad[:5]))}.")
    if previous_keys:
        dropped = sorted(set(previous_keys) - set(payload))
        if dropped:
            raise ValidationError(
                f"{len(dropped)} key(s) from the previous version are missing (e.g. {', '.join(dropped[:3])}). "
                "The file looks incomplete."
            )
