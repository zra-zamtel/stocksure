"""StockSure settings. Everything environment-specific comes from env vars (.env in dev)."""
import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


# Debug is opt-in. A deployment that forgets the env file must not expose tokens.
DEBUG = env_bool("DJANGO_DEBUG", False)
RUNNING_TESTS = "test" in sys.argv

INSECURE_SECRET_KEYS = {
    "dev-insecure-key-change-me",
    "dev-only-change-me-before-deploying",
    "dev-only-change-me-stocksure",
    "change-me",
    "changeme",
}
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG or RUNNING_TESTS:
        SECRET_KEY = "dev-only-change-me-stocksure"
    else:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG is off.")
if not DEBUG and not RUNNING_TESTS and SECRET_KEY in INSECURE_SECRET_KEYS:
    raise ImproperlyConfigured("Replace the placeholder DJANGO_SECRET_KEY before deploying.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS:
    if not DEBUG and not RUNNING_TESTS:
        raise ImproperlyConfigured("Set DJANGO_ALLOWED_HOSTS when DJANGO_DEBUG is off.")
    ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
    # local
    "apps.core",
    "apps.accounts",
    "apps.shops",
    "apps.inventory",
    "apps.sales",
    "apps.reconciliation",
    "apps.ledger",
    "apps.tax",
    "apps.taxpot",
    "apps.taxmate",
    "apps.notifications",
    "apps.ussd",
    "apps.analytics",
    "apps.integrations",
    "apps.sync",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

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
            ]
        },
    }
]

_db_url = os.environ.get("DATABASE_URL", "").strip()
if _db_url:  # PostgreSQL (or anything else) when DATABASE_URL is filled in
    DATABASES = {"default": dj_database_url.parse(_db_url, conn_max_age=600)}
else:  # local SQLite file
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_USER_MODEL = "accounts.User"
# PINs are deliberately short (USSD), so Django's password validators are not enabled.
AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en"
TIME_ZONE = "Africa/Lusaka"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- CORS -------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "origin", "user-agent", "x-shop-id",
]

# --- DRF --------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {
        "anon": "300/min",
        "register": "60/min",
        "login": "60/min",
        "magic": "60/min",
        "staff-signin": "60/min",
        "staff-register": "60/min",
        "staff-pin-reset": "60/min",
        "pin-reset": "60/min",
        "device-pin": "60/min",
        "logout": "60/min",
        "auth": "20/min",
        "sync-push": "120/min",
        "sync-pull": "120/min",
        "ussd": "120/min",
        "webhook": "300/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "StockSure API",
    "DESCRIPTION": "Three-way match of stock, sales and money, with tax readiness (TaxPot, TaxMate).",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- StockSure ----------------------------------------------------------------
# Every external service sits behind a dotted-path backend so real ones can plug in later.
SMS_BACKEND = os.environ.get("SMS_BACKEND", "apps.integrations.sms.ConsoleSMSBackend")
AI_INVOICE_READER = os.environ.get("AI_INVOICE_READER", "apps.integrations.ai.MockInvoiceReader")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
ZAMTEL_WEBHOOK_SECRET = os.environ.get("ZAMTEL_WEBHOOK_SECRET", "").strip()
if not ZAMTEL_WEBHOOK_SECRET and not DEBUG and not RUNNING_TESTS:
    raise ImproperlyConfigured("Set ZAMTEL_WEBHOOK_SECRET when DJANGO_DEBUG is off.")
# A mobile-money payment is matched to a sale of the same amount recorded within this window.
PAYMENT_MATCH_WINDOW_MINUTES = int(os.environ.get("PAYMENT_MATCH_WINDOW_MINUTES", "30"))

# --- Email (magic links) ---------------------------------------------------
# With EMAIL_HOST empty, Django prints the message and link to the server
# console, which is enough for local work. Set EMAIL_HOST for real delivery.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
_default_tls = "0" if EMAIL_USE_SSL else ("1" if EMAIL_HOST else "0")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", _default_tls) == "1"
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
DEFAULT_FROM_EMAIL = os.environ.get(
    "DJANGO_DEFAULT_FROM_EMAIL", "StockSure <no-reply@stocksure.local>"
)
MAGIC_LINK_BASE_URL = os.environ.get("MAGIC_LINK_BASE_URL", "stocksure://magic-link")

# Never enable these on a deployed server: they return one-time codes and
# tokens in API responses instead of sending them by email or SMS.
EXPOSE_EMAIL_TOKEN = env_bool("EXPOSE_EMAIL_TOKEN", False)
EXPOSE_RESET_CODE = env_bool("EXPOSE_RESET_CODE", False)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
USSD_SHARED_SECRET = os.environ.get("USSD_SHARED_SECRET", "")  # set in production; the USSD gateway sends it in X-USSD-Secret
ALLOW_PAYMENT_SIMULATION = env_bool("ALLOW_PAYMENT_SIMULATION", False)  # demo-only; off unless explicitly enabled
