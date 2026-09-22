from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from apps.notifications.models import Notification
from apps.users.models import User
from .models import AuditLog, KYCSubmission


@receiver(pre_save, sender=KYCSubmission)
def stash_old_status_and_stamp_review(sender, instance, **kwargs):
    """
    One DB lookup, two jobs:
    1. Stash the previous status so post_save can tell whether this
       save is a real review decision (see Transaction's pre_save
       for the same pattern).
    2. Stamp reviewed_at the moment status actually changes away
       from pending, regardless of which admin field triggered it.
    """
    if not instance.pk:
        instance._old_status = None
        return
    try:
        old_status = KYCSubmission.objects.get(pk=instance.pk).status
    except KYCSubmission.DoesNotExist:
        instance._old_status = None
        return

    instance._old_status = old_status
    if old_status != instance.status and instance.status != KYCSubmission.Status.PENDING:
        instance.reviewed_at = timezone.now()


@receiver(post_save, sender=KYCSubmission)
def apply_review_decision(sender, instance, created, **kwargs):
    old_status = getattr(instance, "_old_status", None)
    if created or old_status == instance.status:
        return  # not a review decision — either a fresh submission or an unrelated edit

    if instance.status == KYCSubmission.Status.APPROVED:
        user = instance.user
        user.kyc_tier = User.KYCTier.FULL
        # Stamps kyc_verified_at AND fires the "Verification complete"
        # notification via apps/users/signals.py — that signal already
        # covers every path into Full tier (this one, and the manual
        # admin override), so we don't duplicate it here.
        user.save()

        AuditLog.objects.create(
            actor=instance.reviewed_by,
            action="kyc_approved",
            target_model="KYCSubmission",
            target_id=str(instance.pk),
            details={"user_id": str(user.pk)},
        )

    elif instance.status == KYCSubmission.Status.REJECTED:
        Notification.objects.create(
            user=instance.user,
            category=Notification.Category.KYC_UPDATE,
            title="Verification submission rejected",
            body=instance.rejection_reason or "Please review and resubmit your details.",
        )
        AuditLog.objects.create(
            actor=instance.reviewed_by,
            action="kyc_rejected",
            target_model="KYCSubmission",
            target_id=str(instance.pk),
            details={"reason": instance.rejection_reason},
        )
