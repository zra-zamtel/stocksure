"""StockSure settings. Everything environment-specific comes from env vars (.env in dev)."""
import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Tests must never read a developer's backend/.env: it holds the real database
# URL and secrets. They run on a throwaway SQLite database instead.
RUNNING_TESTS = (
    "test" in sys.argv
    or "pytest" in sys.modules
    or "PYTEST_CURRENT_TEST" in os.environ
)
if not RUNNING_TESTS:
    load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


# Debug is opt-in. A deployment that forgets the env file must not expose tokens.
DEBUG = env_bool("DJANGO_DEBUG", False)

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
    "apps.configs",
    "apps.analytics",
    "apps.integrations",
    "apps.sync",
    "apps.collections",
    "apps.smartinvoice",
    "apps.trading_record",
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

# Under tests only TEST_DATABASE_URL can point away from SQLite, so an exported
# DATABASE_URL in the shell cannot send test writes to a real database.
_db_url = (
    os.environ.get("TEST_DATABASE_URL", "") if RUNNING_TESTS else os.environ.get("DATABASE_URL", "")
).strip()
_db_conn_max_age = int(os.environ.get("DB_CONN_MAX_AGE", "0"))
_db_disable_server_side_cursors = env_bool("DB_DISABLE_SERVER_SIDE_CURSORS", False)
if _db_url:  # PostgreSQL (or anything else) when DATABASE_URL is filled in
    DATABASES = {"default": dj_database_url.parse(_db_url, conn_max_age=_db_conn_max_age)}
    if _db_disable_server_side_cursors:
        DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
elif os.environ.get("AWS_LAMBDA_FUNCTION_NAME") and not RUNNING_TESTS:
    # Lambda's filesystem is ephemeral: SQLite would lose every write when the
    # execution environment is recycled or a second environment handles a call.
    raise ImproperlyConfigured("Set DATABASE_URL when deploying to AWS Lambda.")
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

# Lambda's filesystem is read-only at runtime, so invoice and item photos go to
# S3. Leave MEDIA_BUCKET empty for local development.
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "").strip()
if MEDIA_BUCKET:
    _s3_options = {
        "bucket_name": MEDIA_BUCKET,
        "default_acl": None,
        "file_overwrite": False,
        "querystring_auth": True,
        "querystring_expire": int(os.environ.get("AWS_QUERYSTRING_EXPIRE", "3600")),
    }
    _s3_region = os.environ.get("AWS_S3_REGION_NAME") or os.environ.get("AWS_REGION", "")
    if _s3_region:
        _s3_options["region_name"] = _s3_region
    if os.environ.get("AWS_S3_ENDPOINT_URL"):
        _s3_options["endpoint_url"] = os.environ["AWS_S3_ENDPOINT_URL"]
    if os.environ.get("AWS_S3_CUSTOM_DOMAIN"):
        _s3_options["custom_domain"] = os.environ["AWS_S3_CUSTOM_DOMAIN"]
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": _s3_options,
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- CORS -------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "origin", "user-agent", "x-shop-id",
]
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if env_bool("TRUST_PROXY_HEADERS", False):
    # API Gateway terminates TLS and forwards X-Forwarded-Proto to Django.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

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
        "email-code": "60/min",
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
        "collections": "30/min",
        "collections_status": "240/min",
        "trading-record": "10/min",
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
# The VSDC bridge. The simulator is a sandbox; a real, ZRA-certified VSDC
# client replaces it with this one setting.
SMART_INVOICE_BACKEND = os.environ.get(
    "SMART_INVOICE_BACKEND", "apps.smartinvoice.vsdc.SimulatedVsdc"
)
# From this moment an owner with staff can no longer record sales. Sales the
# owner made earlier and sync late are still accepted.
SALES_BY_STAFF_ONLY_FROM = os.environ.get("SALES_BY_STAFF_ONLY_FROM", "2026-11-23T00:00:00+00:00")
PAYMENT_MATCH_WINDOW_MINUTES = int(os.environ.get("PAYMENT_MATCH_WINDOW_MINUTES", "30"))

# --- Email (codes and notices) ---------------------------------------------
# With EMAIL_HOST empty, Django prints the message to the server
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
USSD_SHARED_SECRET = os.environ.get("USSD_SHARED_SECRET", "")  # gateway secret; sent as X-USSD-Secret or ?token= on the callback URL
ALLOW_PAYMENT_SIMULATION = env_bool("ALLOW_PAYMENT_SIMULATION", False)  # demo-only; off unless explicitly enabled

# Request to pay. The simulated provider needs no merchant account and moves
# no money; set COLLECTIONS_PROVIDER to a real provider class once one exists.
COLLECTIONS_PROVIDER = os.environ.get(
    "COLLECTIONS_PROVIDER", "apps.collections.providers.SimulatedProvider"
)
COLLECTIONS_SIMULATED_DELAY_SECONDS = int(os.environ.get("COLLECTIONS_SIMULATED_DELAY_SECONDS", "6"))
COLLECTIONS_TIMEOUT_SECONDS = int(os.environ.get("COLLECTIONS_TIMEOUT_SECONDS", "120"))
# The provider's fee, in percent of what it collects, passed on to the
# customer so the shop nets the full sale. 0 passes nothing on. Lipila: 2.5.
COLLECTIONS_CUSTOMER_FEE_PERCENT = os.environ.get("COLLECTIONS_CUSTOMER_FEE_PERCENT", "0")

# Lipila mobile-money collections (COLLECTIONS_PROVIDER =
# apps.collections.providers.LipilaProvider). api.lipila.dev is the sandbox and
# blz.lipila.io is production; the key must match the host or Lipila returns 401.
LIPILA_API_KEY = os.environ.get("LIPILA_API_KEY", "")
# Absolute base for Trading Record share links (e.g. https://api.stocksure.example).
# Empty: built from the request host.
TRADING_RECORD_PUBLIC_URL = os.environ.get("TRADING_RECORD_PUBLIC_URL", "").strip()

LIPILA_BASE_URL = os.environ.get("LIPILA_BASE_URL", "https://blz.lipila.io")
LIPILA_TIMEOUT_SECONDS = int(os.environ.get("LIPILA_TIMEOUT_SECONDS", "15"))
LIPILA_CALLBACK_URL = os.environ.get("LIPILA_CALLBACK_URL", "")
LIPILA_NARRATION = os.environ.get("LIPILA_NARRATION", "StockSure sale")
