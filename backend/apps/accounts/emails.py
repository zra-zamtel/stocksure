"""Branded StockSure emails.

Every email goes out as plain text plus an HTML version in the app's look:
paper background, the S mark and wordmark, electric-blue accents. The HTML
uses tables and inline styles only, because that is what email clients keep.
"""

from html import escape

from django.conf import settings
from django.core.mail import send_mail

PAPER = "#F5F0E6"
SURFACE = "#FBF8F2"
BORDER = "#D8CBB3"
INK = "#1E1E1C"
MUTED = "#6B655B"
BLUE = "#2F6BFF"
BLUE_INK = "#2559D9"
BLUE_SOFT = "#E4ECFF"
FONT = "Roboto, 'Segoe UI', Helvetica, Arial, sans-serif"


def _logo() -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">'
        "<tr>"
        f'<td style="width:40px;height:40px;background:{INK};border-radius:10px;'
        f'text-align:center;vertical-align:middle;font:800 24px/40px {FONT};color:#FFFFFF;">'
        f'S<span style="color:{BLUE};">.</span></td>'
        f'<td style="padding-left:10px;font:800 26px/40px {FONT};color:{INK};letter-spacing:-0.3px;">'
        f'Stock<span style="color:{BLUE};">Sure</span></td>'
        "</tr></table>"
    )


def render(heading: str, paragraphs: list[str], code: str | None = None, note: str | None = None) -> str:
    """The HTML body. Paragraph text is escaped; nothing here takes raw HTML."""
    body = "".join(
        f'<p style="margin:0 0 16px;font:400 16px/1.55 {FONT};color:{INK};">{escape(p)}</p>'
        for p in paragraphs
    )
    if code:
        body += (
            f'<div style="margin:8px 0 20px;padding:18px 12px;background:{BLUE_SOFT};'
            f'border-radius:12px;text-align:center;font:800 34px/1 {FONT};'
            f'letter-spacing:10px;color:{BLUE_INK};">{escape(code)}</div>'
        )
    if note:
        body += f'<p style="margin:0;font:400 14px/1.5 {FONT};color:{MUTED};">{escape(note)}</p>'

    return (
        "<!doctype html><html><head>"
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(heading)}</title></head>"
        f'<body style="margin:0;padding:0;background:{PAPER};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};">'
        '<tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">'
        f'<tr><td style="padding-bottom:24px;">{_logo()}</td></tr>'
        f'<tr><td style="background:{SURFACE};border:1px solid {BORDER};border-radius:16px;'
        f'border-top:4px solid {BLUE};padding:28px 24px;">'
        f'<h1 style="margin:0 0 16px;font:800 22px/1.3 {FONT};color:{INK};">{escape(heading)}</h1>'
        f"{body}</td></tr>"
        f'<tr><td style="padding:20px 8px 0;text-align:center;font:400 12px/1.5 {FONT};color:{MUTED};">'
        "StockSure &middot; Stock, sales and tax for your shop<br>"
        "This is an automatic email. Replies are not read."
        "</td></tr></table></td></tr></table></body></html>"
    )


def send_branded(
    to: str,
    subject: str,
    heading: str,
    paragraphs: list[str],
    code: str | None = None,
    note: str | None = None,
) -> None:
    text_parts = [heading, "", *paragraphs]
    if code:
        text_parts += ["", f"    {code}", ""]
    if note:
        text_parts += ["", note]
    text_parts += ["", "-- ", "StockSure"]
    send_mail(
        subject=subject,
        message="\n".join(text_parts),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[to],
        html_message=render(heading, paragraphs, code=code, note=note),
        fail_silently=False,
    )
