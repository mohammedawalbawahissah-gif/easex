import uuid
from django.conf import settings
from django.db import models

from apps.transactions.models import Transaction


class ComplianceFlag(models.Model):
    """
    A suspicious-activity flag on a user or transaction. Feeds
    both the manual review queue and, eventually, FIC reporting
    once EaseX is registered as a VASP.
    """

    class Reason(models.TextChoices):
        STRUCTURING = "structuring", "Possible structuring (many small transactions)"
        DUPLICATE_CARD = "duplicate_card", "Duplicate gift card code detected"
        VELOCITY = "velocity", "Unusual transaction velocity"
        MANUAL = "manual", "Manually flagged by reviewer"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        REVIEWING = "reviewing", "Under Review"
        CLEARED = "cleared", "Cleared"
        ESCALATED = "escalated", "Escalated / Reported"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="compliance_flags"
    )
    transaction = models.ForeignKey(
        Transaction, on_delete=models.SET_NULL, null=True, blank=True, related_name="flags"
    )
    reason = models.CharField(max_length=30, choices=Reason.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    notes = models.TextField(blank=True)
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="raised_flags",
        help_text="Null if raised automatically by a system rule",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.reason} — {self.user} ({self.status})"


class AuditLog(models.Model):
    """
    Immutable record of sensitive actions (KYC approval, manual
    transaction verification, payout release). Never update or
    delete rows here — append-only, by design.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="audit_actions"
    )
    action = models.CharField(max_length=100)
    target_model = models.CharField(max_length=100)
    target_id = models.CharField(max_length=100)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} on {self.target_model}:{self.target_id} by {self.actor}"


class KYCSubmission(models.Model):
    """
    Evidence a user submits to move from Basic to Full KYC tier
    (see User.KYCTier.FULL — "ID + selfie verified"). Basic tier is
    granted automatically at registration and never needs a
    submission; this model only ever represents a Full-tier request.

    Review is a staff action (see admin.py) that flips `status`,
    which the signal in signals.py turns into the actual tier bump
    + user notification + audit trail entry.
    """

    class IDType(models.TextChoices):
        NATIONAL_ID = "national_id", "National ID (Ghana Card)"
        PASSPORT = "passport", "Passport"
        VOTERS_ID = "voters_id", "Voter's ID"
        DRIVERS_LICENSE = "drivers_license", "Driver's License"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="kyc_submissions"
    )
    full_name = models.CharField(max_length=150)
    date_of_birth = models.DateField()
    id_type = models.CharField(max_length=20, choices=IDType.choices)
    id_number = models.CharField(max_length=64)
    id_document_front = models.ImageField(upload_to="kyc/%Y/%m/")
    id_document_back = models.ImageField(upload_to="kyc/%Y/%m/", null=True, blank=True)
    selfie = models.ImageField(upload_to="kyc/%Y/%m/")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_kyc_submissions",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-submitted_at"]

    def __str__(self):
        return f"{self.full_name} — {self.status} ({self.user})"
