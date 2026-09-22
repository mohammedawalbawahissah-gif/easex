import uuid
from decimal import Decimal

from django.db import models


class ComplianceRiskSettings(models.Model):
    """
    Single-row, admin-editable thresholds for the automated checks in
    tasks.py — same pattern as payments.PaymentSettings: an operator can
    tune or kill a check without a redeploy. Defaults are conservative
    starting points, not calibrated figures; tune them against real
    transaction volume once you have it.
    """

    velocity_detection_enabled = models.BooleanField(default=True)
    velocity_window_minutes = models.PositiveIntegerField(default=60)
    velocity_max_transactions = models.PositiveIntegerField(
        default=5, help_text="Settled transactions within the window that trigger a VELOCITY flag."
    )

    structuring_detection_enabled = models.BooleanField(default=True)
    structuring_window_hours = models.PositiveIntegerField(default=24)
    structuring_min_transaction_count = models.PositiveIntegerField(
        default=3, help_text="Minimum under-limit transactions before a STRUCTURING flag is considered."
    )
    structuring_sum_threshold_ratio = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal("0.80"),
        help_text="Flag once under-limit transactions in the window sum to this fraction of the user's daily limit.",
    )

    kyc_assist_enabled = models.BooleanField(default=True)
    giftcard_assist_enabled = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Risk & AI-assist settings"
        verbose_name_plural = "Risk & AI-assist settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # singleton — deleting it would just recreate itself with defaults on next .get()

    @classmethod
    def get(cls) -> "ComplianceRiskSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Risk & AI-assist settings"


class KYCAssessment(models.Model):
    """
    One AI pre-read of a KYCSubmission — an assist surfaced next to the
    existing approve/reject buttons in KYCQueue, never a decision. Nothing
    here can approve or reject anything. See tasks.py::assess_kyc_submission.
    """

    class FaceImpression(models.TextChoices):
        LIKELY_MATCH = "likely_match", "Likely match"
        UNCERTAIN = "uncertain", "Uncertain"
        LIKELY_MISMATCH = "likely_mismatch", "Likely mismatch"
        NOT_ASSESSED = "not_assessed", "Not assessed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.OneToOneField(
        "compliance.KYCSubmission", on_delete=models.CASCADE, related_name="ai_assessment"
    )
    extracted_full_name = models.CharField(max_length=150, blank=True)
    # Text, not DateField — OCR output may not be a parseable date; the reviewer reads it as-is.
    extracted_date_of_birth = models.CharField(max_length=30, blank=True)
    name_matches = models.BooleanField(null=True)
    dob_matches = models.BooleanField(null=True)
    face_impression = models.CharField(
        max_length=20, choices=FaceImpression.choices, default=FaceImpression.NOT_ASSESSED
    )
    notes = models.TextField(blank=True, help_text="The model's own brief note, shown to the reviewer as-is.")
    assessed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"AI assessment for KYC submission {self.submission_id}"


class GiftCardAssessment(models.Model):
    """
    One AI pre-read of a GiftCardSubmission's photographed card against
    what the seller declared — an assist surfaced in GiftCardQueue, never
    a decision. See tasks.py::assess_giftcard_submission.
    """

    class Consistency(models.TextChoices):
        CONSISTENT = "consistent", "Matches what was declared"
        MISMATCH = "mismatch", "Doesn't match what was declared"
        UNREADABLE = "unreadable", "Couldn't read the image"
        NOT_ASSESSED = "not_assessed", "Not assessed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.OneToOneField(
        "giftcards.GiftCardSubmission", on_delete=models.CASCADE, related_name="ai_assessment"
    )
    detected_brand = models.CharField(max_length=100, blank=True)
    detected_value_text = models.CharField(
        max_length=50, blank=True, help_text="Value/denomination as read off the card, verbatim."
    )
    consistency = models.CharField(
        max_length=20, choices=Consistency.choices, default=Consistency.NOT_ASSESSED
    )
    notes = models.TextField(blank=True)
    assessed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"AI assessment for gift card submission {self.submission_id}"
