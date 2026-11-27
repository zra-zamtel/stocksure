from datetime import date, datetime

from django import template

register = template.Library()


@register.filter
def kwacha(ngwee):
    """12345 -> 'K123.45'."""
    try:
        value = int(ngwee)
    except (TypeError, ValueError):
        return "—"
    sign = "-" if value < 0 else ""
    value = abs(value)
    return f"{sign}K{value // 100:,}.{value % 100:02d}"


@register.filter
def share(part, whole):
    """Whole-number percent of ``whole``; '—' when there is nothing to divide."""
    try:
        part, whole = int(part), int(whole)
    except (TypeError, ValueError):
        return "—"
    return f"{round(part * 100 / whole)}%" if whole else "—"


@register.filter
def bp_percent(bp):
    try:
        bp = int(bp)
    except (TypeError, ValueError):
        return "—"
    return f"{bp / 100:.1f}%"


@register.filter
def nicedate(value):
    if not value:
        return "—"
    try:
        if "T" in str(value):
            return datetime.fromisoformat(str(value)).strftime("%d %b %Y, %H:%M")
        return date.fromisoformat(str(value)).strftime("%d %b %Y")
    except ValueError:
        return value


@register.filter
def month_label(key):
    try:
        return date.fromisoformat(f"{key}-01").strftime("%b %Y")
    except ValueError:
        return key
