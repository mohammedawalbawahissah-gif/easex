from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import User


@receiver(pre_save, sender=User)
def capture_old_kyc_tier(sender, instance, **kwargs):
    """
    Stash the tier this user had BEFORE this save, so post_save can
    tell whether this save is a real Basic→Full transition. Checking
    `kyc_verified_at is None` is not reliable for this — that
    timestamp is already set the moment someone reaches Basic (at
    registration), so it can't tell Basic-to-Full apart from any
    other later save.
    """
    if not instance.pk:
        instance._old_kyc_tier = None
        return
    try:
        instance._old_kyc_tier = User.objects.get(pk=instance.pk).kyc_tier
    except User.DoesNotExist:
        instance._old_kyc_tier = None


@receiver(post_save, sender=User)
def notify_on_full_verification(sender, instance, created, **kwargs):
    """
    Notify only on the actual transition INTO Full — not on every
    save where kyc_tier happens to equal Full (e.g. an unrelated
    profile edit on an already-Full user).
    """
    old_tier = getattr(instance, "_old_kyc_tier", None)
    if instance.kyc_tier != User.KYCTier.FULL or old_tier == User.KYCTier.FULL:
        return

    from apps.notifications.models import Notification  # local import avoids app-loading-order issues

    Notification.objects.create(
        user=instance,
        category=Notification.Category.KYC_UPDATE,
        title="Verification complete",
        body="Your account is now fully verified. Your transaction limit is 50,000 GHS.",
        related_type="verification",
    )
