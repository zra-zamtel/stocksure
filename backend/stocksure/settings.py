"""Minimal Django settings for the StockSure backend.

The prototype runs on SQLite and a local development server. The mobile app
calls this service once, to register an owner; everything else stays on the
phone. Anything that would be a secret in production comes from the environment.
"""

import os
import sys
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Test runners skip backend/.env so a developer's local settings cannot change
# test results. `manage.py test` is covered by argv, and pytest is covered even
# when it loads settings through a plugin or an IDE.
RUNNING_TESTS = (
    "test" in sys.argv
    or "pytest" in sys.modules
    or bool(os.environ.get("PYTEST_CURRENT_TEST"))
)

# Local development keeps its settings in backend/.env, which is git-ignored.
# Real environment variables win, so a host can always override the file.
if not RUNNING_TESTS:
    load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
INSECURE_SECRET_KEYS = {
    "dev-only-change-me-before-deploying",
    "dev-only-change-me-stocksure",
    "change-me",
    "changeme",
}
if not SECRET_KEY:
    if DEBUG or RUNNING_TESTS:
        SECRET_KEY = "dev-only-change-me-stocksure"
    else:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG is off.")
if not DEBUG and not RUNNING_TESTS and SECRET_KEY in INSECURE_SECRET_KEYS:
    raise ImproperlyConfigured("Replace the placeholder DJANGO_SECRET_KEY before deploying.")

allowed_hosts_env = os.environ.get("DJANGO_ALLOWED_HOSTS", "").strip()
ALLOWED_HOSTS = [host.strip() for host in allowed_hosts_env.split(",") if host.strip()]
if not ALLOWED_HOSTS:
    # Local development and the test client can use any host. A deployed
    # server must name its host explicitly, so a missing setting fails closed.
    if not DEBUG and not RUNNING_TESTS:
        raise ImproperlyConfigured("Set DJANGO_ALLOWED_HOSTS when DJANGO_DEBUG is off.")
    ALLOWED_HOSTS = ["*"]

# These expose one-time tokens in API responses for the demo. They are off by
# default and must never be turned on in a real deployment.
EXPOSE_RESET_CODE = os.environ.get("EXPOSE_RESET_CODE", "0") == "1"

# Email: the console backend prints the magic link during development. Set
# EMAIL_HOST (and usually EMAIL_HOST_USER/EMAIL_HOST_PASSWORD) to send real
# mail through any SMTP provider: Brevo, Gmail, SES, Mailgun, Postmark, etc.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "0") == "1"
default_tls = "0" if EMAIL_USE_SSL else ("1" if EMAIL_HOST else "0")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", default_tls) == "1"
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("Set only one of EMAIL_USE_TLS or EMAIL_USE_SSL.")
if EMAIL_HOST:
    EMAIL_BACKEND = os.environ.get(
        "DJANGO_EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend"
    )
    EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "465" if EMAIL_USE_SSL else "587"))
    EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
    EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "10"))
else:
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

# One DATABASE_URL moves the API from local SQLite to a managed Postgres
# (Neon, Supabase, Railway, Render, ...). Leave it unset for the prototype;
# SQLite remains the zero-setup default for local work and tests.
DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_DISABLE_SERVER_SIDE_CURSORS = os.environ.get("DB_DISABLE_SERVER_SIDE_CURSORS", "0") == "1"
if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=int(os.environ.get("DB_CONN_MAX_AGE", "0")),
            conn_health_checks=True,
            disable_server_side_cursors=DB_DISABLE_SERVER_SIDE_CURSORS,
        )
    }
else:
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
        "register": "60/min",
        "login": "60/min",
        "magic": "60/min",
        "staff-signin": "60/min",
        "staff-register": "60/min",
        "staff-pin-reset": "60/min",
        "pin-reset": "60/min",
    },
}
