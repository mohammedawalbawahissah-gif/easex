from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import GiftCardRate, GiftCardRateHistory


@receiver(post_save, sender=GiftCardRate)
def snapshot_rate_change(sender, instance, **kwargs):
    """
    Every time a brand's rate is created or edited (currently only
    via Django admin), log a snapshot — this is what lets the client
    show a real per-brand rate-change badge instead of a static number.
    """
    GiftCardRateHistory.objects.create(brand=instance.brand, rate=instance.rate)
