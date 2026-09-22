from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Notification
from .tasks import send_push_notification, send_web_push


@receiver(post_save, sender=Notification)
def push_on_create(sender, instance, created, **kwargs):
    if not created:
        return  # only fresh notifications get pushed, not e.g. is_read updates
    send_push_notification.delay(str(instance.id))
    send_web_push.delay(str(instance.id))
