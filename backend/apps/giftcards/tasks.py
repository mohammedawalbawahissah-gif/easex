from celery import shared_task

from . import services


@shared_task
def wipe_stale_codes():
    """Beat task (hourly): erase card codes older than GIFTCARD_CODE_RETENTION_DAYS."""
    return services.wipe_stale_codes()
