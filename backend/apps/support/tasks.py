import logging

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()

# Topics that always go straight to a human — cheaper and more reliable as a
# keyword/state check than trusting a model's judgment call every time, and
# it means these specific cases genuinely can't be talked out of escalating.
# Keep this list short and high-precision; anything subtler is the model's
# job via the escalate_to_human tool (see ai.py).
RESTRICTED_KEYWORDS = (
    "dispute", "unauthorized", "fraud", "scam", "stolen", "chargeback",
    "hacked", "hack", "appeal", "lawyer", "lawsuit", "sue", "police",
)

# How long a session can sit escalated with no one claiming it before it
# falls back to the assistant. Deliberately scoped to "unclaimed" only —
# once an admin claims it (admin_active), the human is engaged and this
# task no longer touches it, even if they're slow to actually type a
# reply. Auto-reclaiming a session an admin is already working on would
# be a worse experience than a slow reply.
STALE_ESCALATION_MINUTES = 5


@shared_task
def notify_admins_of_escalation(session_id):
    """
    Fan out a Notification to every active staff account. Each one
    already triggers push (see apps/notifications/signals.py) through
    the same mobile/web push pipeline used for customer-facing
    notifications, so an on-duty admin sees it without polling.

    This is a blunt "everyone gets pinged" fan-out — fine for a small
    team. If the staff roster grows, swap this for an on-duty rota or
    a claim-race-then-notify-the-rest pattern instead of changing
    anything upstream of this task.
    """
    from apps.notifications.models import Notification
    from apps.support.models import SupportSession

    try:
        session = SupportSession.objects.select_related("user").get(pk=session_id)
    except SupportSession.DoesNotExist:
        return

    staff = list(User.objects.filter(is_staff=True, is_active=True))
    if not staff:
        return
    subject = session.subject or "a support request"
    # Guest sessions have no account — identify them by session id instead
    # of a username the notification would otherwise crash trying to read.
    who = session.user.username if session.user_id else f"a guest (session {str(session.pk)[:8]})"

    created = 0
    for admin in staff:
        # .create() (not bulk_create) so Notification's own post_save signal
        # fires per row and pushes it — see apps/notifications/signals.py.
        Notification.objects.create(
            user=admin,
            category=Notification.Category.SYSTEM,
            title="Customer waiting for an agent",
            body=f"{who} needs help with {subject}.",
            related_type="support_session",
            related_id=str(session.pk),
        )
        created += 1
    logger.debug("Notified %d staff of escalated session %s", created, session_id)


@shared_task
def notify_user_of_reply(session_id):
    """
    Pushes the session's owner when an admin or the assistant replies.
    Only called by services.py for sessions that have a user (guest
    sessions are filtered out before this task is even queued), so no
    guest-safety check is needed here — this task's whole precondition
    is "there is an account to notify."
    """
    from apps.notifications.models import Notification
    from apps.support.models import SupportSession

    try:
        session = SupportSession.objects.select_related("user").get(pk=session_id)
    except SupportSession.DoesNotExist:
        return
    if not session.user_id:
        return

    latest = session.messages.order_by("-created_at").first()
    preview = (latest.body or "Sent an attachment") if latest else "New reply"
    Notification.objects.create(
        user=session.user,
        category=Notification.Category.SYSTEM,
        title="New message from support",
        body=preview[:120],
        related_type="support_session",
        related_id=str(session.pk),
    )


@shared_task(bind=True, max_retries=2, default_retry_delay=10)
def generate_assistant_reply(self, session_id):
    """
    Runs one assistant turn for a session and posts the result — either a
    reply, an escalation (with a short "connecting you" message), or both.
    Triggered by signals.py whenever the user sends a message to a
    bot_active session.
    """
    from . import services
    from .models import SupportMessage, SupportSession

    try:
        session = SupportSession.objects.select_related("user").get(pk=session_id)
    except SupportSession.DoesNotExist:
        return

    if session.status != SupportSession.Status.BOT_ACTIVE:
        return  # claimed or resolved since this task was queued — the bot stays quiet

    user = session.user
    history_qs = list(session.messages.order_by("created_at"))
    latest_user_message = next(
        (m for m in reversed(history_qs) if m.sender == SupportMessage.Sender.USER), None
    )
    text = (latest_user_message.body if latest_user_message else "").lower()

    # --- Deterministic pre-check: skip the model entirely for these ---
    # Guests have no account to flag, so `user and user.is_flagged` is
    # correctly False for them rather than crashing on None.is_flagged.
    if (user and user.is_flagged) or any(k in text for k in RESTRICTED_KEYWORDS):
        services.escalate(
            session_id,
            actor=None,
            reason=SupportSession.EscalationReason.RESTRICTED_INTENT,
            notes=(
                "Auto-routed: flagged account or message matched a restricted topic."
                if (user and user.is_flagged)
                else "Auto-routed: message matched a restricted topic."
            ),
        )
        services.post_assistant_message(
            session_id, body="I'm connecting you with an agent for this — they'll be with you shortly."
        )
        return

    if not settings.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — escalating session %s instead of failing silently.", session_id)
        services.escalate(
            session_id, actor=None, reason=SupportSession.EscalationReason.LOW_CONFIDENCE,
            notes="Assistant is not configured.",
        )
        services.post_assistant_message(
            session_id, body="I'm connecting you with an agent — they'll be with you shortly."
        )
        return

    history = [
        {"role": "user" if m.sender == SupportMessage.Sender.USER else "assistant", "content": m.body}
        for m in history_qs
        if m.sender in (SupportMessage.Sender.USER, SupportMessage.Sender.ASSISTANT)
    ]

    from . import ai

    try:
        result = ai.run_turn(history, user=user)
    except Exception as exc:
        logger.exception("Assistant reply generation failed for session %s", session_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        services.escalate(
            session_id, actor=None, reason=SupportSession.EscalationReason.LOW_CONFIDENCE,
            notes="Assistant error.",
        )
        services.post_assistant_message(
            session_id, body="Something went wrong on my end — connecting you with an agent."
        )
        return

    # Re-check: staff could have claimed the session while the model call was in flight.
    session.refresh_from_db(fields=["status"])
    if session.status != SupportSession.Status.BOT_ACTIVE:
        return

    if result.escalation:
        reason = result.escalation["reason"]
        if reason not in SupportSession.EscalationReason.values:
            reason = SupportSession.EscalationReason.LOW_CONFIDENCE
        services.escalate(session_id, actor=None, reason=reason, notes=result.escalation.get("notes", ""))
        body = result.reply_text or ""
        body = (body + "\n\n" if body else "") + "I'm connecting you with an agent — they'll be with you shortly."
        services.post_assistant_message(session_id, body=body)
        return

    if result.reply_text:
        services.post_assistant_message(session_id, body=result.reply_text)


@shared_task
def revert_stale_escalations():
    """
    Periodic task (see CELERY_BEAT_SCHEDULE) — finds sessions that have
    sat in `escalated` with no one claiming them for longer than
    STALE_ESCALATION_MINUTES, and falls each one back to the assistant
    rather than leaving the user staring at "An agent will be with you
    shortly" indefinitely.

    Queries on escalated_at specifically (not updated_at, which claim()
    also touches) so a session that WAS claimed and later got reassigned
    or reopened doesn't get caught by a stale timestamp from its first
    escalation.
    """
    from django.utils import timezone

    from .models import SupportSession
    from . import services

    cutoff = timezone.now() - timezone.timedelta(minutes=STALE_ESCALATION_MINUTES)
    stale_ids = list(
        SupportSession.objects.filter(
            status=SupportSession.Status.ESCALATED, escalated_at__lte=cutoff
        ).values_list("pk", flat=True)
    )

    reverted = 0
    for session_id in stale_ids:
        session = services.revert_to_bot(str(session_id))
        if session is None:
            continue  # claimed/resolved in the gap between the query above and this call — leave it
        services.post_assistant_message(
            str(session_id),
            body="No agent was available just now — I'm back to help. You can ask to speak to a person again anytime.",
        )
        reverted += 1

    if reverted:
        logger.info("Reverted %d stale escalation(s) back to the assistant", reverted)
