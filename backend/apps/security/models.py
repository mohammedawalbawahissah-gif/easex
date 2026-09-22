from django.conf import settings
from django.db import models


class SecurityProfile(models.Model):
    """Per-user security state: transaction PIN, 2FA, and the post-change cooling-off window."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="security")

    pin_hash = models.CharField(max_length=255, blank=True)
    pin_set_at = models.DateTimeField(null=True, blank=True)

    # Encrypted (Fernet). Present but unconfirmed = the user started setup and hasn't proven it works yet.
    totp_secret_encrypted = models.TextField(blank=True)
    totp_confirmed_at = models.DateTimeField(null=True, blank=True)
    totp_last_step = models.BigIntegerField(default=0, help_text="Newest 30s step already used — blocks code replay")

    money_out_blocked_until = models.DateTimeField(
        null=True, blank=True, help_text="Cooling-off after a password reset / PIN or 2FA change"
    )
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def pin_set(self) -> bool:
        return bool(self.pin_hash)

    @property
    def totp_enabled(self) -> bool:
        return self.totp_confirmed_at is not None and bool(self.totp_secret_encrypted)

    def __str__(self):
        return f"Security profile for {self.user}"


class RecoveryCode(models.Model):
    """One-time 2FA backup codes. Only a keyed digest is stored, never the code."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recovery_codes")
    digest = models.CharField(max_length=64, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
