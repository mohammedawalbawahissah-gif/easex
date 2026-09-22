from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import ExchangeRate, ExchangeRateHistory


@receiver(post_save, sender=ExchangeRate)
def snapshot_rate_change(sender, instance, **kwargs):
    """
    Every time a rate is created or edited (currently only via Django
    admin, until live pricing is integrated — see providers.py), log
    a snapshot. This is what lets the client draw a real fluctuation
    chart instead of a single current-value bar.
    """
    ExchangeRateHistory.objects.create(
        currency=instance.currency,
        buy_rate=instance.buy_rate,
        sell_rate=instance.sell_rate,
    )
