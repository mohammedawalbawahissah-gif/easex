import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    """
    Custom user model. Extends Django's AbstractUser so we keep
    battle-tested password hashing/auth, but add KYC tiering,
    which gates transaction limits across the whole app.
    """

    class KYCTier(models.TextChoices):
        UNVERIFIED = "unverified", "Unverified"
        BASIC = "basic", "Basic (phone + email)"
        FULL = "full", "Full (ID + selfie verified)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=20, unique=True)
    kyc_tier = models.CharField(
        max_length=20, choices=KYCTier.choices, default=KYCTier.UNVERIFIED
    )
    kyc_verified_at = models.DateTimeField(null=True, blank=True)
    is_flagged = models.BooleanField(
        default=False, help_text="Set by compliance app on suspicious activity"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    security_epoch = models.DateTimeField(
        default=timezone.now,
        help_text=(
            "Login sessions issued before this moment are refused. Bumped on password change/reset "
            "and 2FA changes, so a stolen token stops working."
        ),
    )

    def daily_limit(self) -> int:
        """Transaction limit in GHS, gated by KYC tier."""
        limits = {
            self.KYCTier.UNVERIFIED: 0,
            self.KYCTier.BASIC: 2000,
            self.KYCTier.FULL: 50000,
        }
        return limits[self.kyc_tier]

    def save(self, *args, **kwargs):
        # Stamp the verification timestamp the moment a user leaves
        # "unverified" — whether that happened at registration (Basic,
        # set below) or later via an admin manually setting Full.
        # Never overwrite an existing timestamp.
        if self.kyc_tier != self.KYCTier.UNVERIFIED and self.kyc_verified_at is None:
            self.kyc_verified_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.kyc_tier})"

