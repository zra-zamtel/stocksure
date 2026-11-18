"""StockSure settings. Everything environment-specific comes from env vars (.env in dev)."""
import os
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


DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
if not DEBUG and SECRET_KEY == "dev-insecure-key-change-me":
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG is off.")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

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
    "DEFAULT_THROTTLE_RATES": {"auth": "20/min", "ussd": "120/min", "webhook": "300/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
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
ZAMTEL_WEBHOOK_SECRET = os.environ.get("ZAMTEL_WEBHOOK_SECRET", "dev-webhook-secret")
# A mobile-money payment is matched to a sale of the same amount recorded within this window.
PAYMENT_MATCH_WINDOW_MINUTES = int(os.environ.get("PAYMENT_MATCH_WINDOW_MINUTES", "120"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
USSD_SHARED_SECRET = os.environ.get("USSD_SHARED_SECRET", "")  # set in production; the USSD gateway sends it in X-USSD-Secret
ALLOW_PAYMENT_SIMULATION = env_bool("ALLOW_PAYMENT_SIMULATION", True)  # turn off once real Zamtel payments are live
