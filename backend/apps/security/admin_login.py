"""
Two-factor sign-in for Django's built-in /admin/ site.

Django admin normally signs in with a password alone. That would bypass every protection on the
staff API, and it is the most powerful surface in the system. This form adds the authenticator
code (and the same per-account lockout the app uses).
"""

from django import forms
from django.conf import settings
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError

from . import lockout, services


class OtpAdminAuthenticationForm(AdminAuthenticationForm):
    otp = forms.CharField(label="Authenticator code", required=False, strip=True, widget=forms.TextInput(attrs={"autocomplete": "one-time-code"}))

    def clean(self):
        ident = (self.data.get("username") or "").strip().lower()
        try:
            lockout.check("login", ident)
        except lockout.LockedOut as exc:
            raise ValidationError(f"Too many failed attempts. Try again in {max(1, exc.retry_after // 60)} minute(s).")

        try:
            cleaned = super().clean()  # username + password
        except ValidationError:
            lockout.register_failure("login", ident)
            raise

        user = self.get_user()
        if user is None:
            return cleaned
        enabled = services.get_profile(user).totp_enabled
        if enabled or settings.REQUIRE_STAFF_2FA:
            if not enabled:
                raise ValidationError(
                    "Two-factor authentication is required for staff. Turn it on in the EaseX app (Account → Security), then sign in here."
                )
            try:
                services.verify_totp(user, cleaned.get("otp") or "", allow_recovery=True)
            except services.SecurityError as exc:
                raise ValidationError(exc.message)
        lockout.clear("login", ident)
        return cleaned
