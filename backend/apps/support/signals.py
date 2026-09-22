from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import SupportMessage, SupportSession


@receiver(post_save, sender=SupportMessage)
def trigger_assistant_reply(sender, instance, created, **kwargs):
    """
    Only user messages wake the assistant — never its own messages (that
    would loop) and never admin messages (a human is already handling it,
    and the session's status wouldn't be bot_active at that point anyway).
    """
    if not created or instance.sender != SupportMessage.Sender.USER:
        return

    session = instance.session
    if session.status != SupportSession.Status.BOT_ACTIVE:
        return

    from .tasks import generate_assistant_reply

    generate_assistant_reply.delay(str(session.pk))
