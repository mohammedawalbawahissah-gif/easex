"""
Security service layer: transaction PIN, TOTP two-factor, recovery codes, session
revocation and the cooling-off window. Every failed guess feeds the shared lockout counters.
"""

import hashlib
import hmac
import secrets
import time
from datetime import timedelta

import pyotp
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from apps.compliance.models import AuditLog
from apps.notifications.models import Notification

from . import crypto, lockout
from .models import RecoveryCode, SecurityProfile

TOTP_STEP = 30
RECOVERY_CODE_COUNT = 10


class SecurityError(Exception):
    """Something the user can act on. `code` lets clients branch; `retry_after` is seconds (lockouts)."""

    def __init__(self, message: str, code: str = "invalid", retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.retry_after = retry_after


def get_profile(user) -> SecurityProfile:
    profile, _ = SecurityProfile.objects.get_or_create(user=user)
    return profile


def _guarded(scope: str, ident):
    try:
        lockout.check(scope, ident)
    except lockout.LockedOut as exc:
        minutes = max(1, -(-exc.retry_after // 60))
        raise SecurityError(
            f"Too many wrong attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            "locked",
            exc.retry_after,
        )


def _audit(user, action, **details):
    AuditLog.objects.create(actor=user, action=action, target_model="User", target_id=str(user.pk), details=details)


def _notify(user, title, body):
    Notification.objects.create(
        user=user, category=Notification.Category.SYSTEM, title=title, body=body,
        related_type="security",
    )


# ---------------------------------------------------------------------------
# Password (re-entry for sensitive actions)
# ---------------------------------------------------------------------------


def verify_password(user, password: str, *, scope: str = "money_auth"):
    _guarded(scope, user.pk)
    if not user.check_password(password or ""):
        lockout.register_failure(scope, user.pk)
        raise SecurityError("Incorrect password.", "bad_password")
    lockout.clear(scope, user.pk)


# ---------------------------------------------------------------------------
# Transaction PIN
# ---------------------------------------------------------------------------


def validate_pin_format(pin: str):
    if not (isinstance(pin, str) and len(pin) == 6 and pin.isdigit()):
        raise SecurityError("Your PIN must be exactly 6 digits.", "pin_format")
    digits = [int(c) for c in pin]
    steps = {b - a for a, b in zip(digits, digits[1:])}
    if len(set(pin)) == 1 or steps == {1} or steps == {-1}:
        raise SecurityError("That PIN is too easy to guess (like 111111 or 123456). Choose another.", "pin_weak")


def _pin_digest(user, pin: str) -> str:
    # Peppered with a server secret: a stolen database alone can't be used to brute-force 1M possible PINs.
    return hmac.new(settings.PIN_PEPPER.encode(), f"{user.pk}:{pin}".encode(), hashlib.sha256).hexdigest()


def verify_pin(user, pin: str):
    """The everyday step-up for moving money. Raises SecurityError (pin_not_set / bad_pin / locked)."""
    _guarded("money_auth", user.pk)
    profile = get_profile(user)
    if not profile.pin_set:
        raise SecurityError("Set your transaction PIN before moving money.", "pin_not_set")
    if not check_password(_pin_digest(user, str(pin or "")), profile.pin_hash):
        lockout.register_failure("money_auth", user.pk)
        raise SecurityError("Incorrect PIN.", "bad_pin")
    lockout.clear("money_auth", user.pk)


def set_pin(user, *, new_pin: str, password: str, otp: str | None = None):
    """Set or change the PIN. Needs the password (+ a 2FA code if 2FA is on)."""
    verify_password(user, password)
    require_otp_if_enabled(user, otp)
    validate_pin_format(new_pin)
    with transaction.atomic():
        profile = SecurityProfile.objects.select_for_update().get(pk=get_profile(user).pk)
        first_time = not profile.pin_set
        profile.pin_hash = make_password(_pin_digest(user, new_pin))
        profile.pin_set_at = timezone.now()
        profile.save()
        if not first_time:
            start_cooling_off(user)
        _audit(user, "pin_set" if first_time else "pin_changed")
    _notify(
        user,
        "Transaction PIN " + ("set" if first_time else "changed"),
        "Your transaction PIN was " + ("set." if first_time else "changed, so money can't leave your account for the next "
        f"{settings.SECURITY_COOLING_OFF_HOURS} hours.") + " If this wasn't you, contact support immediately.",
    )


# ---------------------------------------------------------------------------
# Two-factor (TOTP) + recovery codes
# ---------------------------------------------------------------------------


def _recovery_digest(code: str) -> str:
    return hmac.new(settings.PIN_PEPPER.encode(), f"recovery:{code.replace('-', '').lower()}".encode(), hashlib.sha256).hexdigest()


def _matching_step(secret: str, code: str, last_step: int):
    totp = pyotp.TOTP(secret, interval=TOTP_STEP)
    now_step = int(time.time() // TOTP_STEP)
    for step in (now_step, now_step - 1, now_step + 1):  # one step either side for clock drift
        if step > last_step and hmac.compare_digest(totp.at(step * TOTP_STEP), code):
            return step
    return None


def _check_totp(user, profile, code: str) -> bool:
    secret = crypto.decrypt(profile.totp_secret_encrypted)
    step = _matching_step(secret, code, profile.totp_last_step)
    if step is None:
        return False
    # Compare-and-set: the same code can never be accepted twice, even by two racing requests.
    return SecurityProfile.objects.filter(pk=profile.pk, totp_last_step__lt=step).update(totp_last_step=step) == 1


def _use_recovery_code(user, code: str) -> bool:
    return RecoveryCode.objects.filter(user=user, digest=_recovery_digest(code), used_at__isnull=True).update(
        used_at=timezone.now()
    ) == 1


def verify_totp(user, code: str, *, allow_recovery: bool = False, pending: bool = False):
    """Verify a current authenticator code (or, if allowed, a one-time recovery code)."""
    _guarded("otp", user.pk)
    profile = get_profile(user)
    code = (code or "").strip().replace(" ", "")
    has_secret = bool(profile.totp_secret_encrypted) and (pending or profile.totp_enabled)
    ok = False
    if has_secret and code.isdigit() and len(code) == 6:
        ok = _check_totp(user, profile, code)
    elif allow_recovery and profile.totp_enabled and len(code.replace("-", "")) == 12:
        ok = _use_recovery_code(user, code)
    if not ok:
        lockout.register_failure("otp", user.pk)
        raise SecurityError("That code isn't right, or it was already used. Wait for the next code and try again.", "bad_otp")
    lockout.clear("otp", user.pk)


def require_otp_if_enabled(user, otp: str | None, *, allow_recovery: bool = False):
    if get_profile(user).totp_enabled:
        if not otp:
            raise SecurityError("Enter the 6-digit code from your authenticator app.", "otp_required")
        verify_totp(user, otp, allow_recovery=allow_recovery)


def begin_totp_setup(user, *, password: str) -> dict:
    verify_password(user, password)
    profile = get_profile(user)
    if profile.totp_enabled:
        raise SecurityError("Two-factor authentication is already on.", "already_enabled")
    secret = pyotp.random_base32()
    profile.totp_secret_encrypted = crypto.encrypt(secret)
    profile.totp_confirmed_at = None
    profile.totp_last_step = 0
    profile.save()
    uri = pyotp.TOTP(secret, interval=TOTP_STEP).provisioning_uri(
        name=user.email or user.username, issuer_name=settings.TOTP_ISSUER
    )
    return {"secret": secret, "otpauth_uri": uri}


def new_recovery_codes(user) -> list[str]:
    RecoveryCode.objects.filter(user=user).delete()
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = secrets.token_hex(6)
        codes.append(f"{raw[:6]}-{raw[6:]}")
    RecoveryCode.objects.bulk_create([RecoveryCode(user=user, digest=_recovery_digest(c)) for c in codes])
    return codes


def enable_totp(user, *, code: str) -> list[str]:
    """Confirm setup with a first code; returns the recovery codes — shown ONCE."""
    profile = get_profile(user)
    if profile.totp_enabled:
        raise SecurityError("Two-factor authentication is already on.", "already_enabled")
    if not profile.totp_secret_encrypted:
        raise SecurityError("Start setup first.", "not_started")
    verify_totp(user, code, pending=True)
    with transaction.atomic():
        SecurityProfile.objects.filter(pk=profile.pk).update(totp_confirmed_at=timezone.now())
        codes = new_recovery_codes(user)
        _audit(user, "2fa_enabled")
    _notify(user, "Two-factor authentication turned on", "Your account now needs a code from your authenticator app to sign in.")
    return codes


def disable_totp(user, *, password: str, code: str):
    verify_password(user, password)
    profile = get_profile(user)
    if not profile.totp_enabled:
        raise SecurityError("Two-factor authentication isn't on.", "not_enabled")
    verify_totp(user, code, allow_recovery=True)
    with transaction.atomic():
        SecurityProfile.objects.filter(pk=profile.pk).update(
            totp_secret_encrypted="", totp_confirmed_at=None, totp_last_step=0
        )
        RecoveryCode.objects.filter(user=user).delete()
        start_cooling_off(user)
        _audit(user, "2fa_disabled")
    _notify(
        user,
        "Two-factor authentication turned off",
        f"Money can't leave your account for the next {settings.SECURITY_COOLING_OFF_HOURS} hours as a precaution. "
        "If this wasn't you, contact support immediately.",
    )


def regenerate_recovery_codes(user, *, password: str, code: str) -> list[str]:
    verify_password(user, password)
    if not get_profile(user).totp_enabled:
        raise SecurityError("Two-factor authentication isn't on.", "not_enabled")
    verify_totp(user, code)  # a real authenticator code — a recovery code can't mint new recovery codes
    codes = new_recovery_codes(user)
    _audit(user, "recovery_codes_regenerated")
    return codes


# ---------------------------------------------------------------------------
# Sessions and the cooling-off window
# ---------------------------------------------------------------------------


def revoke_sessions(user):
    """
    Log this user out everywhere: refresh tokens are blacklisted, and access tokens issued
    before now are refused by SecureJWTAuthentication. (Granularity is one second, the
    resolution of the JWT `iat` claim.)
    """
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    user.security_epoch = timezone.now()
    user.save(update_fields=["security_epoch"])
    outstanding = OutstandingToken.objects.filter(user=user)
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token=t) for t in outstanding], ignore_conflicts=True)
    _audit(user, "sessions_revoked")


def issue_tokens(user) -> dict:
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def start_cooling_off(user):
    until = timezone.now() + timedelta(hours=settings.SECURITY_COOLING_OFF_HOURS)
    SecurityProfile.objects.filter(pk=get_profile(user).pk).update(money_out_blocked_until=until)


def cooling_off_until(user):
    until = get_profile(user).money_out_blocked_until
    return until if until and until > timezone.now() else None
