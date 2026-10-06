import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"

_DEV_SECRET_KEY = "dev-only-change-me"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", _DEV_SECRET_KEY)

# Used by apps.support (customer assistant) and apps.risk (KYC/gift-card
# vision assists + admin copilot). If unset, apps.support escalates every
# session straight to a human instead of failing silently, and apps.risk's
# vision assists simply produce no assessment — neither one breaks without it.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Fail loudly at startup rather than silently running production with
# a publicly-known secret key — this key signs every session/CSRF
# token and (indirectly) JWTs, so shipping the dev default would be
# a genuine security hole, not just a style issue.
if not DEBUG and SECRET_KEY == _DEV_SECRET_KEY:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be set to a real secret when DJANGO_DEBUG=False. "
        "Generate one with: python -c \"from django.core.management.utils import "
        "get_random_secret_key; print(get_random_secret_key())\""
    )

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "anymail",
    "apps.users",
    "apps.wallets",
    "apps.transactions",
    "apps.giftcards",
    "apps.compliance",
    "apps.notifications",
    "apps.exchange",
    "apps.payments",
    "apps.security",
    "apps.support",
    "apps.risk",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Serves STATIC_ROOT directly from gunicorn — no separate static-file host
    # needed on Railway. Must sit right after SecurityMiddleware.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

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

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Postgres — required for ledger integrity.
# Railway's managed Postgres plugin provides a single DATABASE_URL, so that
# takes priority when present. Local Docker Compose has no DATABASE_URL, so
# it falls back to the discrete POSTGRES_* vars exactly as before — this
# doesn't change local dev at all.
import dj_database_url  # noqa: E402

if os.environ.get("DATABASE_URL"):
    DATABASES = {
        "default": dj_database_url.parse(
            os.environ["DATABASE_URL"],
            conn_max_age=600,
            ssl_require=not DEBUG,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("POSTGRES_DB", "easex_db"),
            "USER": os.environ.get("POSTGRES_USER", "easex_user"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "easex_pass"),
            "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        }
    }

AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # Same as SimpleJWT's, plus: tokens issued before a password/PIN/2FA change are refused.
        "apps.security.authentication.SecureJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "user": "120/min",
        "anon": "20/min",
        # Payments (apps/payments/views.py). Password-confirmed endpoints are
        # kept tight so they can't be used to guess a password.
        "money_out": "10/min",
        "money_in": "20/min",
        "lookup": "15/min",
        "money": "30/min",
        "sensitive": "10/min",  # PIN / 2FA / recovery-code changes
        # Starting a support session is what wakes the AI assistant — the
        # general "user" rate (120/min) bounds request volume fine, but
        # doesn't stop someone from opening many separate sessions to run
        # up AI API cost. A guest (anon, keyed by IP) gets the tighter
        # rate — an authenticated account is at least identifiable and
        # already reuses one open session (see support/services.py), so
        # legitimate use rarely approaches even the tighter number.
        "ai_session_start": "10/hour",
    },
}

# ---------------------------------------------------------------------------
# Shared cache (rate limits + lockout counters)
# ---------------------------------------------------------------------------
# These counters MUST be shared between web workers. With Django's default
# per-process cache, 4 gunicorn workers gave an attacker 4x the guesses, and a
# lockout set by one worker was invisible to the others. Redis fixes that.
# (Uses Django's built-in Redis backend; the `redis` package is already installed for Celery.)
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse  # noqa: E402


def _redis_url_with_db(url: str, db: int) -> str:
    """Same Redis server, different database index — keeps cache keys away from Celery's."""
    parts = urlparse(url)
    if parts.scheme == "unix":
        query = dict(parse_qsl(parts.query))
        query["db"] = str(db)
        return urlunparse(parts._replace(query=urlencode(query)))
    return urlunparse(parts._replace(path=f"/{db}"))


_REDIS_URL = os.environ.get("REDIS_URL")
if os.environ.get("CACHE_REDIS_URL") or _REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": os.environ.get("CACHE_REDIS_URL") or _redis_url_with_db(_REDIS_URL, 1),
            "OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},
        }
    }
elif DEBUG:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
else:
    raise ImproperlyConfigured(
        "REDIS_URL must be set when DJANGO_DEBUG=False. Rate limits and account lockouts need a cache "
        "shared by all workers; a per-process cache would let an attacker multiply their guesses."
    )

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
# Encrypts secrets stored in the database (gift card codes, 2FA secrets). Comma-separated
# Fernet keys: the FIRST encrypts, all can decrypt — so you rotate by prepending a new key.
# Generate one:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FIELD_ENCRYPTION_KEYS = [k.strip() for k in os.environ.get("FIELD_ENCRYPTION_KEYS", "").split(",") if k.strip()]
if not FIELD_ENCRYPTION_KEYS:
    if DEBUG:
        import base64
        import hashlib

        FIELD_ENCRYPTION_KEYS = [base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()).decode()]
    else:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEYS must be set when DJANGO_DEBUG=False (it encrypts gift card codes and 2FA secrets)."
        )

# Mixed into PIN hashes so a leaked database alone can't be used to brute-force 6-digit PINs offline.
PIN_PEPPER = os.environ.get("PIN_PEPPER") or SECRET_KEY
# After a password reset, PIN change or 2FA change, money can't LEAVE the account for this long —
# so a hijacked email inbox can't reset the password and withdraw within the hour.
SECURITY_COOLING_OFF_HOURS = int(os.environ.get("SECURITY_COOLING_OFF_HOURS", "24"))
# Staff can approve payouts and reveal card codes, so they must use 2FA.
REQUIRE_STAFF_2FA = os.environ.get("REQUIRE_STAFF_2FA", "True") == "True"
TOTP_ISSUER = os.environ.get("TOTP_ISSUER", "EaseX")
# Where Django's built-in admin lives. Move it off the default in production (e.g. ADMIN_URL=ops-7f3k/)
# so it isn't found by every scanner; it also requires an authenticator code (see security/admin_login.py).
ADMIN_URL = os.environ.get("ADMIN_URL", "admin/").strip("/") + "/"
# Keyed fingerprint used to spot the same card being sold twice. Keyed (HMAC), not a bare hash:
# gift card codes are short, so a plain SHA-256 could be brute-forced from a leaked database.
# Don't change this once cards exist, or duplicate detection for those cards weakens.
GIFTCARD_FINGERPRINT_KEY = os.environ.get("GIFTCARD_FINGERPRINT_KEY") or SECRET_KEY
GIFTCARD_CODE_RETENTION_DAYS = int(os.environ.get("GIFTCARD_CODE_RETENTION_DAYS", "30"))

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# CORS — restrict to your actual web/mobile origins in production;
# never leave CORS_ALLOW_ALL_ORIGINS on for a fintech app.
CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://localhost:5174, http://localhost:5175"
).split(",")

CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TIMEZONE = "Africa/Accra"

# Periodic tasks. Needs ONE `celery beat` process running (see
# docker-compose.yml) — without it, scheduled transfers never fire.
CELERY_BEAT_SCHEDULE = {
    "run-due-scheduled-transfers": {
        "task": "apps.payments.tasks.process_due_scheduled_transfers",
        "schedule": 60.0,
    },
    "run-due-scheduled-loads": {
        "task": "apps.payments.tasks.process_due_scheduled_loads",
        "schedule": 60.0,
    },
    "run-due-scheduled-withdrawals": {
        "task": "apps.payments.tasks.process_due_scheduled_withdrawals",
        "schedule": 60.0,
    },
    "wipe-stale-gift-card-codes": {
        "task": "apps.giftcards.tasks.wipe_stale_codes",
        "schedule": 3600.0,
    },
    "requeue-unsent-withdrawals": {
        "task": "apps.payments.tasks.dispatch_stuck_withdrawals",
        "schedule": 180.0,
    },
    "revert-stale-support-escalations": {
        "task": "apps.support.tasks.revert_stale_escalations",
        "schedule": 60.0,
    },
}

# --- Payments ---------------------------------------------------------------
# "manual": no external calls; an admin confirms loads and sends payouts by
#           hand (safe default, works with no payment gateway).
# "stub":   fake instant success for local development. Can create money
#           from nothing, so it is refused unless DEBUG=True.
PAYMENTS_PROVIDER = os.environ.get("PAYMENTS_PROVIDER", "manual")
if not DEBUG and PAYMENTS_PROVIDER == "stub":
    raise ImproperlyConfigured(
        "PAYMENTS_PROVIDER=stub is only allowed with DJANGO_DEBUG=True — it can create money from nothing."
    )

# Mobile money / bank rails — see apps/payments/providers.py get_provider_for().
# Each is OFF by default; nothing changes here until you deliberately turn
# one on, same safety posture as PAYMENTS_PROVIDER above.

# Hubtel: covers MTN MoMo, Telecel Cash and AirtelTigo Money collections/payouts.
HUBTEL_ENABLED = os.environ.get("HUBTEL_ENABLED", "False") == "True"
HUBTEL_CLIENT_ID = os.environ.get("HUBTEL_CLIENT_ID", "")
HUBTEL_CLIENT_SECRET = os.environ.get("HUBTEL_CLIENT_SECRET", "")
HUBTEL_POS_SALES_ID = os.environ.get("HUBTEL_POS_SALES_ID", "")  # merchant account / POS Sales ID
# Public HTTPS URL Hubtel POSTs collection outcomes to. Must be reachable
# from the internet (not localhost) — see apps/payments/webhooks.py.
HUBTEL_CALLBACK_URL = os.environ.get("HUBTEL_CALLBACK_URL", "")

# MTN MoMo direct (MTN's own Open API) — an alternative to Hubtel for MTN
# traffic specifically. Leave off to let Hubtel carry all three networks.
MTN_MOMO_DIRECT_ENABLED = os.environ.get("MTN_MOMO_DIRECT_ENABLED", "False") == "True"
MTN_MOMO_SUBSCRIPTION_KEY = os.environ.get("MTN_MOMO_SUBSCRIPTION_KEY", "")
MTN_MOMO_API_USER = os.environ.get("MTN_MOMO_API_USER", "")
MTN_MOMO_API_KEY = os.environ.get("MTN_MOMO_API_KEY", "")
MTN_MOMO_TARGET_ENVIRONMENT = os.environ.get("MTN_MOMO_TARGET_ENVIRONMENT", "sandbox")
MTN_MOMO_CALLBACK_URL = os.environ.get("MTN_MOMO_CALLBACK_URL", "")
# MTN doesn't sign its callbacks, so the callback URL itself carries a
# shared secret path segment — see apps/payments/webhooks.py.
MTN_MOMO_CALLBACK_TOKEN = os.environ.get("MTN_MOMO_CALLBACK_TOKEN", "")

# "manual": show the user EaseX's bank details, a human reconciles (default).
# "bank_transfer": use BankTransferProvider (currently the same behaviour,
#                  as its own class so it's a one-line swap if you later
#                  contract an automated bank rail).
BANK_PROVIDER = os.environ.get("BANK_PROVIDER", "manual")


# Web push (browser notifications) — see apps/notifications/tasks.py.
# Mobile push uses Expo's own token-routing instead (no VAPID needed
# there); this pair is specifically for the web app's service worker.
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS_EMAIL = os.environ.get("VAPID_CLAIMS_EMAIL", "mailto:admin@easex.example")

# Used to build the password-reset link emailed to the user — must
# point at wherever the web app's /reset-password page actually lives.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

# Console backend prints emails to the backend's log — fine for local
# development. In production this is Anymail, which gives one Django
# EMAIL_BACKEND interface over SendGrid, SES, Postmark, Mailgun, Resend,
# etc., so swapping providers later is a settings change, not a rewrite.
# EMAIL_PROVIDER selects which Anymail backend to use; ANYMAIL below holds
# each provider's own API key setting (only the selected one needs a value).
EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "console")
_EMAIL_BACKENDS = {
    "console": "django.core.mail.backends.console.EmailBackend",
    "sendgrid": "anymail.backends.sendgrid.EmailBackend",
    "ses": "anymail.backends.amazon_ses.EmailBackend",
    "postmark": "anymail.backends.postmark.EmailBackend",
    "mailgun": "anymail.backends.mailgun.EmailBackend",
    "resend": "anymail.backends.resend.EmailBackend",
}
if EMAIL_PROVIDER not in _EMAIL_BACKENDS:
    raise ImproperlyConfigured(f"Unknown EMAIL_PROVIDER '{EMAIL_PROVIDER}'.")
if not DEBUG and EMAIL_PROVIDER == "console":
    raise ImproperlyConfigured(
        "EMAIL_PROVIDER=console prints emails to the log instead of sending them — "
        "fine for development, not allowed with DJANGO_DEBUG=False."
    )
EMAIL_BACKEND = _EMAIL_BACKENDS[EMAIL_PROVIDER]
ANYMAIL = {
    "SENDGRID_API_KEY": os.environ.get("SENDGRID_API_KEY", ""),
    "POSTMARK_SERVER_TOKEN": os.environ.get("POSTMARK_SERVER_TOKEN", ""),
    "MAILGUN_API_KEY": os.environ.get("MAILGUN_API_KEY", ""),
    "MAILGUN_SENDER_DOMAIN": os.environ.get("MAILGUN_SENDER_DOMAIN", ""),
    "RESEND_API_KEY": os.environ.get("RESEND_API_KEY", ""),
    # SES authenticates via the standard AWS_* env vars / instance role,
    # not an Anymail-specific key.
}
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@easex.app")

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Accra"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Media storage (gift card images, KYC documents) ------------------------
# Cloudflare R2 (S3-compatible) when configured — required in production,
# since Railway's filesystem doesn't persist across redeploys. Falls back to
# local disk when R2 isn't configured, so docker-compose dev is unaffected.
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "")  # e.g. https://<account_id>.r2.cloudflarestorage.com
# Optional: a public R2.dev URL or custom domain you've mapped to the bucket,
# used to build the links users/admins actually see for uploaded files.
R2_PUBLIC_BASE_URL = os.environ.get("R2_PUBLIC_BASE_URL", "")

_R2_CONFIGURED = all([R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT_URL])

if not _R2_CONFIGURED and not DEBUG:
    raise ImproperlyConfigured(
        "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_ENDPOINT_URL must all be set "
        "when DJANGO_DEBUG=False — gift card images and KYC documents can't live on Railway's local "
        "disk, which doesn't persist across redeploys."
    )

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
# A third-party package occasionally references a static file (e.g. a
# source map) that doesn't exist. Strict mode would fail the whole
# collectstatic/deploy over that; False just skips rewriting that one
# reference, which is the common, low-risk way to handle it.
WHITENOISE_MANIFEST_STRICT = False

if _R2_CONFIGURED:
    AWS_ACCESS_KEY_ID = R2_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = R2_SECRET_ACCESS_KEY
    AWS_STORAGE_BUCKET_NAME = R2_BUCKET_NAME
    AWS_S3_ENDPOINT_URL = R2_ENDPOINT_URL
    AWS_S3_REGION_NAME = "auto"
    AWS_S3_ADDRESSING_STYLE = "virtual"
    AWS_DEFAULT_ACL = None  # R2 buckets manage public access at the bucket level, not per-object ACLs
    AWS_QUERYSTRING_AUTH = False  # serve plain URLs; set True instead if the bucket must stay private
    if R2_PUBLIC_BASE_URL:
        AWS_S3_CUSTOM_DOMAIN = R2_PUBLIC_BASE_URL.replace("https://", "").replace("http://", "").rstrip("/")

    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage"}
    MEDIA_URL = (R2_PUBLIC_BASE_URL.rstrip("/") + "/") if R2_PUBLIC_BASE_URL else f"{R2_ENDPOINT_URL}/{R2_BUCKET_NAME}/"
else:
    STORAGES["default"] = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    MEDIA_URL = "/media/"
    MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Web's GiftCards.tsx validates images up to 5MB client-side — Django's
# default (2.5MB) would silently reject anything between 2.5-5MB with
# a 400 the client never expected. 6MB gives headroom above what the
# frontend already allows.
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024

# Security settings that only make sense — and are only safe to
# enable — once DEBUG is off. Forcing HTTPS locally would break
# `docker compose up` development.
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000  # 1 year, standard once you're confident HTTPS is stable
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"
    # Railway/Render (and most PaaS hosts) terminate TLS at a proxy and
    # forward plain HTTP internally — without this, Django can't tell
    # the original request was HTTPS, and SECURE_SSL_REDIRECT above
    # would redirect-loop forever.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Without explicit logging config, unhandled errors in production are
# easy to lose — this sends them to stdout/stderr, which Docker,
# Railway, and Render all capture and let you view as logs.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
    },
}
