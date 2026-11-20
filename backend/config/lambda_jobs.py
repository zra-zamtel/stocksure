"""AWS Lambda entry point for work that is not an HTTP request.

The EventBridge schedule sends ``{"job": "reminder"}``. Migrations and the SMTP
smoke test are invoked by hand with the same function, for example:

    {"job": "migrate"}
    {"job": "smtp-check", "to": "owner@example.com"}
"""

import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings  # noqa: E402
from django.core.mail import send_mail  # noqa: E402
from django.core.management import call_command  # noqa: E402


def _smtp_check(event):
    recipient = (event or {}).get("to") or os.environ.get("SMTP_CHECK_TO", "")
    if not isinstance(recipient, str) or "@" not in recipient:
        return {"ok": False, "error": 'Pass {"job": "smtp-check", "to": "you@example.com"}.'}

    send_mail(
        "StockSure SMTP check",
        "SMTP delivery from the StockSure Lambda backend works.",
        settings.DEFAULT_FROM_EMAIL,
        [recipient],
        fail_silently=False,
    )
    console_backend = "console" in settings.EMAIL_BACKEND.lower()
    return {
        "ok": True,
        "job": "smtp-check",
        "to": recipient,
        "email_backend": settings.EMAIL_BACKEND,
        "email_host": settings.EMAIL_HOST,
        "email_port": getattr(settings, "EMAIL_PORT", None),
        "warning": (
            "EMAIL_HOST is empty; the message was written to CloudWatch Logs, not emailed."
            if console_backend
            else None
        ),
    }


def handler(event, context):
    job = (event or {}).get("job", "reminder")

    if job == "migrate":
        call_command("migrate", interactive=False)
        return {"ok": True, "job": job}

    if job == "reminder":
        call_command("send_reminders")
        return {"ok": True, "job": job}

    if job == "smtp-check":
        return _smtp_check(event)

    raise ValueError(f"Unknown job {job!r}. Use migrate, reminder or smtp-check.")
