"""
Independent of apps/compliance/signals.py, apps/transactions/signals.py, and
apps/giftcards/signals.py — this app never edits those files, it just adds
its own receivers on the same models. Django dispatches a signal to every
connected receiver regardless of which app connected it, so this coexists
with whatever those apps already do without touching them.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.compliance.models import KYCSubmission
from apps.giftcards.models import GiftCardSubmission
from apps.transactions.models import Transaction


@receiver(post_save, sender=Transaction)
def on_transaction_saved(sender, instance, created, **kwargs):
    """
    Reads the `_old_status` attribute that apps/transactions/signals.py's own
    pre_save receiver already stashes on the instance (both apps' receivers
    see the same instance). If that attribute isn't present for any reason
    this simply doesn't fire — it never blocks or interferes with the
    actual settlement/notification logic either way.
    """
    old_status = getattr(instance, "_old_status", None)
    if created or old_status == instance.status:
        return
    if instance.status != Transaction.Status.SETTLED:
        return

    from .tasks import check_transaction_risk

    check_transaction_risk.delay(str(instance.pk))


@receiver(post_save, sender=KYCSubmission)
def on_kyc_submitted(sender, instance, created, **kwargs):
    if not created:
        return
    from .tasks import assess_kyc_submission

    assess_kyc_submission.delay(str(instance.pk))


@receiver(post_save, sender=GiftCardSubmission)
def on_giftcard_submitted(sender, instance, created, **kwargs):
    if not created:
        return
    from .tasks import assess_giftcard_submission

    assess_giftcard_submission.delay(str(instance.pk))
