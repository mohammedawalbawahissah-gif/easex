import logging
from decimal import Decimal

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Compliance anomaly detection — fills the gap that was already half-built:
# ComplianceFlag.Reason had STRUCTURING and VELOCITY as choices with nothing
# in the codebase ever raising them. Statistics, not a model — cheaper,
# explainable to a regulator, and auditable. Triggered by signals.py whenever
# a transaction settles.
# ---------------------------------------------------------------------------

@shared_task
def check_transaction_risk(transaction_id):
    from apps.transactions.models import Transaction

    from .models import ComplianceRiskSettings

    settings_row = ComplianceRiskSettings.get()
    try:
        txn = Transaction.objects.select_related("user").get(pk=transaction_id)
    except Transaction.DoesNotExist:
        return

    user = txn.user
    if settings_row.velocity_detection_enabled:
        _check_velocity(user, settings_row)
    if settings_row.structuring_detection_enabled:
        _check_structuring(user, settings_row)


def _has_open_flag(user, reason, since) -> bool:
    from apps.compliance.models import ComplianceFlag

    return ComplianceFlag.objects.filter(
        user=user,
        reason=reason,
        created_at__gte=since,
        status__in=[ComplianceFlag.Status.OPEN, ComplianceFlag.Status.REVIEWING],
    ).exists()


def _check_velocity(user, settings_row):
    from apps.compliance.models import ComplianceFlag
    from apps.transactions.models import Transaction

    window_start = timezone.now() - timezone.timedelta(minutes=settings_row.velocity_window_minutes)
    if _has_open_flag(user, ComplianceFlag.Reason.VELOCITY, window_start):
        return  # don't spam a second flag while one's still open

    count = Transaction.objects.filter(
        user=user, status=Transaction.Status.SETTLED, created_at__gte=window_start,
    ).count()
    if count >= settings_row.velocity_max_transactions:
        ComplianceFlag.objects.create(
            user=user,
            reason=ComplianceFlag.Reason.VELOCITY,
            notes=(
                f"{count} settled transactions in the last {settings_row.velocity_window_minutes} minutes "
                f"(threshold {settings_row.velocity_max_transactions})."
            ),
        )


def _check_structuring(user, settings_row):
    from apps.compliance.models import ComplianceFlag
    from apps.transactions.models import Transaction

    limit = Decimal(str(user.daily_limit()))
    if limit <= 0:
        return  # nothing to structure around if there's no limit yet (e.g. unverified tier)

    window_start = timezone.now() - timezone.timedelta(hours=settings_row.structuring_window_hours)
    if _has_open_flag(user, ComplianceFlag.Reason.STRUCTURING, window_start):
        return

    under_limit = Transaction.objects.filter(
        user=user,
        status=Transaction.Status.SETTLED,
        created_at__gte=window_start,
        ghs_value__isnull=False,
        ghs_value__lt=limit,
    )
    count = under_limit.count()
    if count < settings_row.structuring_min_transaction_count:
        return

    total = sum((t.ghs_value for t in under_limit), Decimal("0"))
    threshold = limit * settings_row.structuring_sum_threshold_ratio
    if total >= threshold:
        ComplianceFlag.objects.create(
            user=user,
            reason=ComplianceFlag.Reason.STRUCTURING,
            notes=(
                f"{count} transactions each under the {limit} GHS daily limit, totalling {total} GHS "
                f"in the last {settings_row.structuring_window_hours}h (threshold {threshold} GHS)."
            ),
        )


# ---------------------------------------------------------------------------
# KYC review assist — reads the ID + selfie, cross-checks against what the
# user typed, gives a visual impression of the face match. All of it is a
# hint next to the existing approve/reject buttons; nothing here decides
# anything. Triggered by signals.py when a KYCSubmission is created.
# ---------------------------------------------------------------------------

KYC_SYSTEM_PROMPT = (
    "You are a document pre-check for a KYC reviewer at a Ghanaian fintech. You are given an ID "
    "document image and a selfie. Extract what's printed on the ID and give your visual impression "
    "of whether the selfie shows the same person as the ID photo. You are not a certified biometric "
    "system and your impression is not authoritative — say so plainly if either image is unclear "
    "rather than guessing. Reply with JSON only, no other text, matching exactly this shape:\n"
    '{"extracted_full_name": "", "extracted_date_of_birth": "", '
    '"face_impression": "likely_match" | "uncertain" | "likely_mismatch", "notes": ""}\n'
    "notes should be one or two short sentences a reviewer can read in passing."
)


@shared_task
def assess_kyc_submission(submission_id):
    from apps.compliance.models import KYCSubmission

    from . import vision
    from .models import ComplianceRiskSettings, KYCAssessment

    if not ComplianceRiskSettings.get().kyc_assist_enabled:
        return
    try:
        submission = KYCSubmission.objects.get(pk=submission_id)
    except KYCSubmission.DoesNotExist:
        return

    images = [
        vision.image_block(getattr(submission, "id_document_front", None)),
        vision.image_block(getattr(submission, "selfie", None)),
    ]
    result = vision.ask_vision_json(
        system=KYC_SYSTEM_PROMPT,
        text_prompt=(
            f'The submitter entered name "{submission.full_name}" and date of birth '
            f"{submission.date_of_birth}. Compare against the ID image."
        ),
        images=images,
    )
    if result is None:
        return

    extracted_name = (result.get("extracted_full_name") or "").strip()
    extracted_dob = (result.get("extracted_date_of_birth") or "").strip()
    face = result.get("face_impression")
    if face not in KYCAssessment.FaceImpression.values:
        face = KYCAssessment.FaceImpression.UNCERTAIN

    name_matches = extracted_name.strip().lower() == submission.full_name.strip().lower() if extracted_name else None
    dob_matches = extracted_dob.strip() == str(submission.date_of_birth) if extracted_dob else None

    KYCAssessment.objects.update_or_create(
        submission=submission,
        defaults={
            "extracted_full_name": extracted_name[:150],
            "extracted_date_of_birth": extracted_dob[:30],
            "name_matches": name_matches,
            "dob_matches": dob_matches,
            "face_impression": face,
            "notes": (result.get("notes") or "")[:2000],
        },
    )


# ---------------------------------------------------------------------------
# Gift card submission assist — checks the photographed card against the
# declared brand/subcategory/value. Same "hint, not decision" contract as
# the KYC assist. Triggered by signals.py when a GiftCardSubmission is
# created (only runs if a card_image was actually provided).
# ---------------------------------------------------------------------------

GIFTCARD_SYSTEM_PROMPT = (
    "You are a pre-check for a gift card reviewer. You are given a photo of a gift card and what "
    "the seller declared about it. Read what's visible on the card and say whether it's consistent "
    "with the declared brand and value. Reply with JSON only, no other text, matching exactly this "
    "shape:\n"
    '{"detected_brand": "", "detected_value_text": "", '
    '"consistency": "consistent" | "mismatch" | "unreadable", "notes": ""}\n'
    "notes should be one short sentence a reviewer can read in passing."
)


@shared_task
def assess_giftcard_submission(submission_id):
    from apps.giftcards.models import GiftCardSubmission
    from apps.giftcards.services import brand_display_name

    from . import vision
    from .models import ComplianceRiskSettings, GiftCardAssessment

    if not ComplianceRiskSettings.get().giftcard_assist_enabled:
        return
    try:
        submission = GiftCardSubmission.objects.select_related("subcategory__brand").get(pk=submission_id)
    except GiftCardSubmission.DoesNotExist:
        return
    if not submission.card_image:
        return  # nothing to look at — not an error, just no photo was provided

    result = vision.ask_vision_json(
        system=GIFTCARD_SYSTEM_PROMPT,
        text_prompt=(
            f"Declared brand: {brand_display_name(submission)}. "
            f"Declared face value: {submission.face_value} {submission.card_currency}."
        ),
        images=[vision.image_block(submission.card_image)],
    )
    if result is None:
        return

    consistency = result.get("consistency")
    if consistency not in GiftCardAssessment.Consistency.values:
        consistency = GiftCardAssessment.Consistency.UNREADABLE

    GiftCardAssessment.objects.update_or_create(
        submission=submission,
        defaults={
            "detected_brand": (result.get("detected_brand") or "")[:100],
            "detected_value_text": (result.get("detected_value_text") or "")[:50],
            "consistency": consistency,
            "notes": (result.get("notes") or "")[:2000],
        },
    )
