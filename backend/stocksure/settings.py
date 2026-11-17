"""Minimal Django settings for the StockSure backend.

The prototype runs on SQLite and a local development server. The mobile app
calls this service once, to register an owner; everything else stays on the
phone. Anything that would be a secret in production comes from the environment.
"""

import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
if not SECRET_KEY:
    if DEBUG or "test" in sys.argv:
        SECRET_KEY = "dev-only-change-me-stocksure"
    else:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG is off.")
ALLOWED_HOSTS = [host for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",") if host]

# These expose one-time tokens in API responses for the demo. They are off by
# default and must never be turned on in a real deployment.
EXPOSE_RESET_CODE = os.environ.get("EXPOSE_RESET_CODE", "0") == "1"

# The prototype has no email provider yet. The console backend prints the
# message so the demo can open the link. A real deployment uses SMTP/SES and
# turns exposure off.
EMAIL_BACKEND = os.environ.get(
    "DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
)
DEFAULT_FROM_EMAIL = os.environ.get("DJANGO_DEFAULT_FROM_EMAIL", "StockSure <no-reply@stocksure.local>")
MAGIC_LINK_BASE_URL = os.environ.get("MAGIC_LINK_BASE_URL", "stocksure://magic-link")
EXPOSE_EMAIL_TOKEN = os.environ.get("EXPOSE_EMAIL_TOKEN", "0") == "1"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "accounts",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "stocksure.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "stocksure.wsgi.application"
ASGI_APPLICATION = "stocksure.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-zm"
TIME_ZONE = "Africa/Lusaka"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The app posts to /api/v1/auth/register without a trailing slash. Do not let
# CommonMiddleware answer a POST with a 301 to /register/, which would lose the
# request body.
APPEND_SLASH = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "300/min",
        "login": "60/min",
        "magic": "60/min",
        "staff-signin": "60/min",
        "staff-register": "60/min",
        "pin-reset": "60/min",
    },
}
