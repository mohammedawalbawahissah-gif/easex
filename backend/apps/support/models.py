import uuid

from django.conf import settings
from django.db import models


class SupportSession(models.Model):
    """
    One customer-support conversation. Starts with the assistant; may
    escalate to a human. This is the queue the admin Support page
    reads from, the same shape as the KYC/gift-card review queues —
    items land, get claimed, get acted on, and every state change is
    audited (see services.py).

    A user should generally have at most one non-resolved session at
    a time — services.start_session enforces that by returning the
    existing open session instead of creating a duplicate.
    """

    class Status(models.TextChoices):
        BOT_ACTIVE = "bot_active", "Assistant handling"
        ESCALATED = "escalated", "Waiting for an agent"
        ADMIN_ACTIVE = "admin_active", "Agent handling"
        RESOLVED = "resolved", "Resolved"

    class EscalationReason(models.TextChoices):
        USER_REQUESTED = "user_requested", "User asked for a human"
        RESTRICTED_INTENT = "restricted_intent", "Topic always routes to a human"
        LOW_CONFIDENCE = "low_confidence", "Assistant couldn't resolve it"
        MANUAL = "manual", "Escalated by staff"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Nullable: a guest (not signed in) session has no user, only guest_id.
    # Exactly one of (user, guest_id) is set — enforced in services.py, not
    # here, since "which one" depends on how the session was started, not
    # on anything the database itself can validate cheaply.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="support_sessions",
        null=True,
        blank=True,
    )
    # Client-generated UUID (stored in localStorage on web, SecureStore on
    # mobile) that identifies a guest across requests without an account.
    # When a guest later signs in, services.claim_guest_session reassigns
    # user and clears this, folding the conversation into their real
    # history — see services.py.
    guest_id = models.UUIDField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.BOT_ACTIVE)

    # Short label for the admin queue list, e.g. "Gift card payout" — set by the
    # assistant once it has enough context, optional otherwise.
    subject = models.CharField(max_length=150, blank=True)

    escalation_reason = models.CharField(
        max_length=30, choices=EscalationReason.choices, blank=True
    )
    escalation_notes = models.TextField(blank=True)

    assigned_admin = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claimed_support_sessions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "updated_at"]),
            models.Index(fields=["user", "status"]),
            models.Index(fields=["guest_id", "status"]),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        who = self.user or f"guest:{self.guest_id}"
        return f"Support session {self.id} — {who} ({self.status})"


class SupportMessage(models.Model):
    """
    One message in a session. `sender` records who's speaking, not who
    the row belongs to — a session's messages are a single shared
    transcript, same as GiftCardSubmission's reviewer_notes is one
    field everyone involved reads, not per-party state.
    """

    class Sender(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"
        ADMIN = "admin", "Admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SupportSession, on_delete=models.CASCADE, related_name="messages")
    sender = models.CharField(max_length=10, choices=Sender.choices)
    # Set only for sender=admin, so the transcript (and the admin queue) can show
    # WHICH staff member said what, even after a session changes hands.
    sender_admin = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    body = models.TextField(blank=True)
    # Optional single attachment — any media type (image, video, PDF,
    # document). A message can be attachment-only (blank body) or
    # text-only (no attachment); the UI just doesn't render an empty
    # bubble for either half. Not fed to the assistant's model in this
    # phase — vision/document analysis of attachments is a follow-up,
    # not something this field's presence implies.
    attachment = models.FileField(upload_to="support_attachments/%Y/%m", blank=True, null=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_content_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["session", "created_at"])]

    def __str__(self):
        return f"{self.sender} in {self.session_id}: {self.body[:40]}"
