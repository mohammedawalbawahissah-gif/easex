"""
Support session lifecycle — the single implementation behind the
user-facing chat endpoint and the staff queue (views.py), so
"escalate" or "resolve" can't mean two different things depending
on which surface triggered it. Mirrors the shape of
apps/giftcards/services.py: a locked read, a state check, one write,
one AuditLog entry.

This module deliberately does NOT call any AI model — it only
manages session/message state and hand-off. Wire the assistant in as
a caller of post_user_message (e.g. from a Celery task that reads the
new message, decides bot_active vs. escalate, and calls
post_assistant_message or escalate accordingly).

Guest sessions: a session belongs to either `user` or `guest_id`,
never both — start_session/start_guest_session enforce which at
creation, and every ownership check below branches on which one the
session actually has rather than assuming a user exists.
"""

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.compliance.models import AuditLog

from .models import SupportMessage, SupportSession

User = get_user_model()

OPEN_STATUSES = (
    SupportSession.Status.BOT_ACTIVE,
    SupportSession.Status.ESCALATED,
    SupportSession.Status.ADMIN_ACTIVE,
)


class SupportError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _audit(actor, action, session, **details):
    AuditLog.objects.create(
        actor=actor,
        action=action,
        target_model="SupportSession",
        target_id=str(session.pk),
        details=details,
    )


def _lock(session_id) -> SupportSession:
    """
    No select_related("user") here deliberately: user is nullable now
    (guest sessions), and Postgres refuses FOR NO KEY UPDATE on the
    nullable side of an outer join. Callers that need session.user just
    take one extra lazy query for it — cheap, and this path isn't hot.
    """
    try:
        return SupportSession.objects.select_for_update(no_key=True).get(pk=session_id)
    except SupportSession.DoesNotExist:
        raise SupportError("Support session not found.")


def _owns(session: SupportSession, *, user=None, guest_id=None) -> bool:
    if user is not None and user.is_authenticated:
        return session.user_id == user.pk
    if guest_id is not None:
        return session.guest_id is not None and str(session.guest_id) == str(guest_id)
    return False


def start_session(user) -> SupportSession:
    """Reuse the user's existing open session rather than starting a second one."""
    existing = SupportSession.objects.filter(user=user, status__in=OPEN_STATUSES).order_by("-updated_at").first()
    if existing:
        return existing
    return SupportSession.objects.create(user=user, status=SupportSession.Status.BOT_ACTIVE)


def start_guest_session(guest_id) -> SupportSession:
    """Same reuse rule as start_session, keyed by the client-generated guest_id instead of a user."""
    existing = (
        SupportSession.objects.filter(guest_id=guest_id, status__in=OPEN_STATUSES).order_by("-updated_at").first()
    )
    if existing:
        return existing
    return SupportSession.objects.create(guest_id=guest_id, status=SupportSession.Status.BOT_ACTIVE)


def claim_guest_session(guest_id, *, user):
    """
    Called right after login/signup when the client had a guest_id with an
    open session. Folds it into the now-authenticated user's history by
    reassigning `user` and clearing `guest_id` — the transcript carries
    over untouched, it just gains an owner. Returns None (not an error) if
    there was nothing to claim, since "no guest session" is the common case.
    """
    with transaction.atomic():
        session = (
            SupportSession.objects.select_for_update(no_key=True)
            .filter(guest_id=guest_id, status__in=OPEN_STATUSES)
            .order_by("-updated_at")
            .first()
        )
        if not session:
            return None
        # If the user already has their own open session, keep theirs and
        # just leave the guest one as an orphaned (but still readable)
        # history entry rather than silently merging two live transcripts.
        if SupportSession.objects.filter(user=user, status__in=OPEN_STATUSES).exists():
            return None
        session.user = user
        session.guest_id = None
        session.save(update_fields=["user", "guest_id", "updated_at"])
        _audit(user, "support_guest_claimed", session)
        return session


def post_user_message(session_id, *, user=None, guest_id=None, body: str = "", attachment=None) -> SupportMessage:
    if not body and not attachment:
        raise SupportError("Message needs text or an attachment.")
    with transaction.atomic():
        session = _lock(session_id)
        if not _owns(session, user=user, guest_id=guest_id):
            raise SupportError("This isn't your support session.")
        if session.status == SupportSession.Status.RESOLVED:
            raise SupportError("This session is closed. Start a new one.")
        message = _create_message(session, sender=SupportMessage.Sender.USER, body=body, attachment=attachment)
        session.save(update_fields=["updated_at"])  # bump ordering for the queue
        return message


def post_assistant_message(session_id, *, body: str) -> SupportMessage:
    """Called by whatever process runs the model (a Celery task, typically)."""
    with transaction.atomic():
        session = _lock(session_id)
        message = SupportMessage.objects.create(session=session, sender=SupportMessage.Sender.ASSISTANT, body=body)
        session.save(update_fields=["updated_at"])
    _notify_user_of_reply(session)
    return message


def escalate(session_id, *, actor=None, reason: str, notes: str = "") -> SupportSession:
    """
    actor=None means the assistant escalated it (low confidence / restricted
    intent); actor=a staff user means a human escalated another session
    manually. Either way this only changes status — claiming (below) is a
    separate, explicit staff action, so two admins can't both think they own it.
    """
    if reason not in SupportSession.EscalationReason.values:
        raise SupportError("Unknown escalation reason.")
    with transaction.atomic():
        session = _lock(session_id)
        if session.status == SupportSession.Status.RESOLVED:
            raise SupportError("This session is already resolved.")
        if session.status in (SupportSession.Status.ESCALATED, SupportSession.Status.ADMIN_ACTIVE):
            return session  # already escalated — no-op, not an error
        session.status = SupportSession.Status.ESCALATED
        session.escalation_reason = reason
        session.escalation_notes = notes
        session.escalated_at = timezone.now()
        session.save(
            update_fields=["status", "escalation_reason", "escalation_notes", "escalated_at", "updated_at"]
        )
        _audit(actor, "support_escalated", session, reason=reason, notes=notes)

    from .tasks import notify_admins_of_escalation

    notify_admins_of_escalation.delay(str(session.pk))
    return session


def revert_to_bot(session_id) -> SupportSession | None:
    """
    Falls a session back to the assistant after it's sat unclaimed too
    long — see tasks.revert_stale_escalations, which is the only caller.
    Re-checks status under lock (not just escalated_at) so a session an
    admin claimed in the gap between the task's query and this call isn't
    yanked back — that race is exactly why this re-verifies rather than
    trusting the caller's snapshot.
    """
    with transaction.atomic():
        session = _lock(session_id)
        if session.status != SupportSession.Status.ESCALATED:
            return None  # claimed, resolved, or already reverted since the task queried — nothing to do
        session.status = SupportSession.Status.BOT_ACTIVE
        session.escalated_at = None
        session.save(update_fields=["status", "escalated_at", "updated_at"])
        _audit(None, "support_auto_reverted_to_bot", session)
        return session


def claim(session_id, *, actor) -> SupportSession:
    with transaction.atomic():
        session = _lock(session_id)
        if session.status != SupportSession.Status.ESCALATED:
            raise SupportError("Only a session that's waiting for an agent can be claimed.")
        session.status = SupportSession.Status.ADMIN_ACTIVE
        session.assigned_admin = actor
        session.escalated_at = None
        session.save(update_fields=["status", "assigned_admin", "escalated_at", "updated_at"])
        _audit(actor, "support_claimed", session)
        return session


def post_admin_message(session_id, *, actor, body: str = "", attachment=None) -> SupportMessage:
    if not body and not attachment:
        raise SupportError("Message needs text or an attachment.")
    with transaction.atomic():
        session = _lock(session_id)
        if session.status != SupportSession.Status.ADMIN_ACTIVE or session.assigned_admin_id != actor.pk:
            raise SupportError("Claim this session before replying.")
        message = _create_message(
            session, sender=SupportMessage.Sender.ADMIN, sender_admin=actor, body=body, attachment=attachment
        )
        session.save(update_fields=["updated_at"])
    _notify_user_of_reply(session)
    return message


def resolve(session_id, *, actor, notes: str = "") -> SupportSession:
    with transaction.atomic():
        session = _lock(session_id)
        if session.status == SupportSession.Status.RESOLVED:
            raise SupportError("Already resolved.")
        session.status = SupportSession.Status.RESOLVED
        session.resolved_at = timezone.now()
        if notes:
            session.escalation_notes = (session.escalation_notes + "\n" + notes).strip()
        session.save(update_fields=["status", "resolved_at", "escalation_notes", "updated_at"])
        _audit(actor, "support_resolved", session, notes=notes)
        return session


def _create_message(session, *, sender, body="", attachment=None, sender_admin=None) -> SupportMessage:
    kwargs = dict(session=session, sender=sender, body=body, sender_admin=sender_admin)
    if attachment is not None:
        kwargs["attachment"] = attachment
        kwargs["attachment_name"] = getattr(attachment, "name", "") or ""
        kwargs["attachment_content_type"] = getattr(attachment, "content_type", "") or ""
    return SupportMessage.objects.create(**kwargs)


def _notify_user_of_reply(session: SupportSession) -> None:
    """
    Pushes to the session's owner when an admin or the assistant replies —
    guest sessions have no account and so no device token to push to, and
    are silently skipped here rather than treated as an error; the guest
    still sees the reply next time they poll the widget.
    """
    if not session.user_id:
        return
    from .tasks import notify_user_of_reply

    notify_user_of_reply.delay(str(session.pk))
