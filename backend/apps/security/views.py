from django.contrib.auth import authenticate
from django.core import signing
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle
from rest_framework.views import APIView

from apps.users.models import User

from . import lockout, services
from .models import RecoveryCode
from .services import SecurityError

MFA_SALT = "easex.login.mfa"
MFA_TOKEN_MAX_AGE = 5 * 60


def security_error_response(exc: SecurityError) -> Response:
    body = {"detail": exc.message, "code": exc.code}
    if exc.retry_after is not None:
        body["retry_after"] = exc.retry_after
    return Response(body, status=status.HTTP_429_TOO_MANY_REQUESTS if exc.code == "locked" else status.HTTP_400_BAD_REQUEST)


class SecureView(APIView):
    """Authenticated + tightly throttled. SecurityError -> {detail, code, retry_after?}."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "sensitive"

    def handle_exception(self, exc):
        if isinstance(exc, SecurityError):
            return security_error_response(exc)
        return super().handle_exception(exc)


def _str(request, name):
    value = request.data.get(name, "")
    return value if isinstance(value, str) else ""


class SecurityStatusView(SecureView):
    throttle_scope = "money"

    def get(self, request):
        profile = services.get_profile(request.user)
        cooling = services.cooling_off_until(request.user)
        return Response(
            {
                "pin_set": profile.pin_set,
                "totp_enabled": profile.totp_enabled,
                "totp_setup_pending": bool(profile.totp_secret_encrypted) and not profile.totp_enabled,
                "recovery_codes_remaining": RecoveryCode.objects.filter(user=request.user, used_at__isnull=True).count(),
                "cooling_off_until": cooling.isoformat() if cooling else None,
                "is_staff": request.user.is_staff,
            }
        )


class PinView(SecureView):
    def post(self, request):
        services.set_pin(
            request.user, new_pin=_str(request, "pin"), password=_str(request, "password"), otp=_str(request, "otp") or None
        )
        return Response({"detail": "PIN saved."})


class TotpSetupView(SecureView):
    def post(self, request):
        return Response(services.begin_totp_setup(request.user, password=_str(request, "password")))


class TotpEnableView(SecureView):
    def post(self, request):
        codes = services.enable_totp(request.user, code=_str(request, "code"))
        services.revoke_sessions(request.user)  # sign out anywhere else; this device gets fresh tokens
        return Response({"recovery_codes": codes, "tokens": services.issue_tokens(request.user)})


class TotpDisableView(SecureView):
    def post(self, request):
        services.disable_totp(request.user, password=_str(request, "password"), code=_str(request, "code"))
        services.revoke_sessions(request.user)
        return Response({"detail": "Two-factor authentication is off.", "tokens": services.issue_tokens(request.user)})


class RecoveryCodesView(SecureView):
    def post(self, request):
        codes = services.regenerate_recovery_codes(request.user, password=_str(request, "password"), code=_str(request, "code"))
        return Response({"recovery_codes": codes})


# ---------------------------------------------------------------------------
# Login (replaces SimpleJWT's TokenObtainPairView)
# ---------------------------------------------------------------------------


class LoginView(APIView):
    """
    Step 1 of sign-in. Wrong password 5x for a username in 15 minutes locks that username
    (shared across all workers) — whether or not the account exists, so this can't be used
    to discover valid usernames. If the account has 2FA, returns a short-lived `mfa_token`
    instead of tokens, to be exchanged with a code at /login/2fa/.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        username = _str(request, "username").strip()
        password = _str(request, "password")
        ident = username.lower()
        try:
            lockout.check("login", ident)
        except lockout.LockedOut as exc:
            return Response(
                {"detail": "Too many failed sign-in attempts. Please try again later.", "code": "locked", "retry_after": exc.retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        user = authenticate(request, username=username, password=password) if username and password else None
        if user is None or not user.is_active:
            lockout.register_failure("login", ident)
            return Response({"detail": "No active account found with the given credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        lockout.clear("login", ident)

        if services.get_profile(user).totp_enabled:
            token = signing.dumps({"uid": str(user.pk)}, salt=MFA_SALT)
            return Response({"mfa_required": True, "mfa_token": token})
        return Response(services.issue_tokens(user))


class Login2FAView(APIView):
    """Step 2 of sign-in for accounts with 2FA: the mfa_token from step 1 + an authenticator (or recovery) code."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        try:
            payload = signing.loads(_str(request, "mfa_token"), salt=MFA_SALT, max_age=MFA_TOKEN_MAX_AGE)
            user = User.objects.get(pk=payload["uid"], is_active=True)
        except (signing.BadSignature, User.DoesNotExist, KeyError):
            return Response({"detail": "This sign-in has expired. Please start again.", "code": "mfa_expired"}, status=400)
        try:
            services.verify_totp(user, _str(request, "code"), allow_recovery=True)
        except SecurityError as exc:
            return security_error_response(exc)
        return Response(services.issue_tokens(user))
