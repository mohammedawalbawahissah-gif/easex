"""
Gift card review — the single implementation behind both the staff
portal (views.py) and Django admin (admin.py), so "approve" can never
mean two different things depending on where it was clicked.

Approval is an ATTESTATION: the reviewer states the card has really been
redeemed and for how much. Only then does any money move. The payout is
computed here from that number and the server-owned rate — never from
anything the seller typed.

If auto-payment is enabled (PaymentSettings), approval also credits the
seller's wallet immediately, and — for sellers who opted in and pass the
safety checks — sends the proceeds on to their mobile money account.
"""

import hashlib
import hmac
import logging
import re
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from django.conf import settings
from django.core.cache import cache

from django.db import transaction
from django.utils import timezone

from apps.compliance.models import AuditLog, ComplianceFlag
from apps.notifications.models import Notification
from apps.payments import services as payments
from apps.payments.models import PaymentSettings
from apps.security import crypto, services as security
from apps.transactions.models import Transaction

from .models import GiftCardSubmission

logger = logging.getLogger(__name__)
CENT = Decimal("0.01")


class ReviewError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def payout_for(value: Decimal, rate: Decimal) -> Decimal:
    """GHS payout = card value (in the card's currency) x rate (GHS per unit), rounded DOWN to the pesewa."""
    return (Decimal(value) * Decimal(rate)).quantize(CENT, rounding=ROUND_DOWN)


def brand_display_name(submission) -> str:
    """The brand's proper name, falling back to the stored slug for legacy / removed brands."""
    if submission.subcategory_id:
        return submission.subcategory.brand.name
    return submission.brand.replace("_", " ").title()


def normalize_card_code(code: str) -> str:
    """Case, spaces and dashes are not different cards."""
    return re.sub(r"[^A-Za-z0-9]", "", code or "").upper()


def card_code_hashes(code: str):
    """
    (fingerprint to store, older fingerprints to ALSO check for duplicates).

    Current: HMAC-SHA256 of the normalised code with a server-side key — a leaked database can't be used
    to brute-force short codes. Older schemes (plain SHA-256 of the normalised text, and of the raw text)
    are still checked so cards submitted before this change still count as duplicates.
    """
    normalised = normalize_card_code(code)
    current = hmac.new(settings.GIFTCARD_FINGERPRINT_KEY.encode(), normalised.encode(), hashlib.sha256).hexdigest()
    older = [hashlib.sha256(normalised.encode()).hexdigest(), hashlib.sha256((code or "").encode()).hexdigest()]
    return current, older


def _audit(actor, action, submission, **details):
    AuditLog.objects.create(
        actor=actor,
        action=action,
        target_model="GiftCardSubmission",
        target_id=str(submission.pk),
        details={k: (str(v) if isinstance(v, Decimal) else v) for k, v in details.items()},
    )


def _lock(submission_id):
    submission = GiftCardSubmission.objects.select_for_update(no_key=True, of=("self",)).select_related("user").get(pk=submission_id)
    txn = Transaction.objects.select_for_update(no_key=True).get(pk=submission.transaction_id)
    if txn.status != Transaction.Status.UNDER_REVIEW:
        raise ReviewError("This submission has already been reviewed.")
    return submission, txn


def approve_submission(submission_id, *, actor, redeemed_confirmed, redeemed_value, redemption_reference="", notes=""):
    """Returns the submission. Raises ReviewError for anything the reviewer can fix."""
    if redeemed_confirmed is not True:
        raise ReviewError("Confirm that you have redeemed this card before approving it.")
    try:
        redeemed_value = Decimal(str(redeemed_value))
    except (InvalidOperation, ValueError, TypeError):
        raise ReviewError("Enter the amount you redeemed from the card.")
    if not redeemed_value.is_finite() or redeemed_value <= 0:
        raise ReviewError("The redeemed amount must be greater than 0.")
    if redeemed_value.as_tuple().exponent < -2:
        raise ReviewError("The redeemed amount can have at most 2 decimal places.")

    ps = PaymentSettings.get()
    with transaction.atomic():
        submission, txn = _lock(submission_id)

        if redeemed_value > submission.face_value:
            raise ReviewError(
                "The redeemed amount is higher than the face value the seller declared. "
                "Reject it and ask them to resubmit, rather than paying more than declared."
            )
        payout = payout_for(redeemed_value, submission.offered_rate)
        if payout <= 0:
            raise ReviewError("That amount is too small to pay out.")

        now = timezone.now()
        submission.redeemed_value = redeemed_value
        submission.redemption_reference = (redemption_reference or "").strip()[:100]
        submission.redeemed_at = now
        submission.verified_value = payout
        submission.reviewed_by = actor
        submission.reviewed_at = now
        submission.reviewer_notes = notes or submission.reviewer_notes
        _erase_code(submission, now)  # redeemed — the code has done its job
        submission.save()

        # The wallet will be credited txn.amount — make it the approved figure.
        # (Previously it stayed at the seller's own estimate, whatever was approved.)
        txn.amount = payout
        txn.verified_by = actor
        txn.verified_at = now
        txn.status = Transaction.Status.VERIFIED
        txn.save()

        outcome = {"auto_settled": False, "auto_payout": None}
        sub = submission.subcategory
        # Open-loop prepaid cards (and legacy submissions with no subcategory) are never
        # auto-paid: an admin settles them by hand, whatever the global switch says.
        auto_allowed = bool(sub and sub.allow_auto_payment)
        if ps.giftcard_auto_payment_enabled and not auto_allowed:
            outcome["manual_reason"] = "This card type needs manual settlement."
        if ps.giftcard_auto_payment_enabled and auto_allowed:
            txn.status = Transaction.Status.SETTLED
            txn.save()  # signal credits the wallet
            outcome["auto_settled"] = True

            try:
                with transaction.atomic():  # a payout problem must never undo the credit above
                    outcome["auto_payout"] = payments.auto_payout_for_giftcard(
                        user=submission.user, amount=payout, submission_id=submission.pk
                    )
            except Exception:
                logger.exception("Auto-payout crashed for submission %s", submission.pk)
                outcome["auto_payout"] = {"status": "skipped", "reason": "unexpected error", "transaction": None}

        txn.metadata["auto_payment"] = outcome
        txn.save(update_fields=["metadata", "updated_at"])

        _audit(
            actor, "giftcard_approved", submission,
            redeemed_value=redeemed_value, payout=payout, reference=submission.redemption_reference,
            auto_settled=outcome["auto_settled"], auto_payout=outcome["auto_payout"],
        )
        return submission


def reject_submission(submission_id, *, actor, notes=""):
    with transaction.atomic():
        submission, txn = _lock(submission_id)
        submission.reviewed_by = actor
        submission.reviewed_at = timezone.now()
        submission.reviewer_notes = notes or submission.reviewer_notes
        _erase_code(submission, submission.reviewed_at)
        submission.save()
        txn.status = Transaction.Status.REJECTED
        txn.save()
        _audit(actor, "giftcard_rejected", submission, notes=notes)
        return submission


def flag_submission(submission_id, *, actor, notes=""):
    with transaction.atomic():
        submission, txn = _lock(submission_id)
        submission.reviewed_by = actor
        submission.reviewed_at = timezone.now()
        submission.reviewer_notes = notes or submission.reviewer_notes
        submission.save()
        txn.status = Transaction.Status.FLAGGED
        txn.save()
        ComplianceFlag.objects.create(
            user=submission.user,
            transaction=txn,
            reason=ComplianceFlag.Reason.MANUAL,
            raised_by=actor,
            notes=notes,
        )
        _audit(actor, "giftcard_flagged", submission, notes=notes)
        return submission


# ---------------------------------------------------------------------------
# Card code: erase + audited reveal
# ---------------------------------------------------------------------------

REVEALS_PER_HOUR = 30


def _erase_code(submission, when=None):
    """Destroy the recoverable code (the keyed fingerprint stays, for duplicate detection)."""
    if submission.card_code_encrypted:
        submission.card_code_encrypted = ""
        submission.code_wiped_at = when or timezone.now()


def reveal_code(submission_id, *, actor, otp: str, ip: str = "") -> str:
    """
    Show a reviewer the card code so they can redeem it. Every safeguard is deliberate:
      * only while the card is still awaiting a decision (approve/reject erases the code);
      * a FRESH authenticator code every time (not just being logged in);
      * capped per reviewer per hour (a compromised staff account can't bulk-harvest codes);
      * one audit-log entry per reveal — who, which card, from where.
    Raises ReviewError (fixable) or SecurityError (bad/locked 2FA code).
    """
    with transaction.atomic():
        submission = GiftCardSubmission.objects.select_for_update(no_key=True, of=("self",)).get(pk=submission_id)
        txn = Transaction.objects.get(pk=submission.transaction_id)
        if txn.status not in (Transaction.Status.UNDER_REVIEW, Transaction.Status.FLAGGED):
            raise ReviewError("This card has already been decided, so its code has been erased.")
        if not submission.card_code_encrypted:
            raise ReviewError("No code is stored for this card (it was submitted before code storage existed, or has been erased).")

        key = f"giftcard:reveals:{actor.pk}"
        cache.add(key, 0, 3600)
        if cache.incr(key) > REVEALS_PER_HOUR:
            raise ReviewError(f"Reveal limit reached ({REVEALS_PER_HOUR} per hour). Try again later.")

        security.verify_totp(actor, otp)  # raises SecurityError

        code = crypto.decrypt(submission.card_code_encrypted)
        submission.code_reveal_count += 1
        submission.save(update_fields=["code_reveal_count"])
        AuditLog.objects.create(
            actor=actor, action="giftcard_code_revealed", target_model="GiftCardSubmission",
            target_id=str(submission.pk), details={"ip": ip, "reveal_number": submission.code_reveal_count},
        )
        return code


def wipe_stale_codes() -> int:
    """Erase codes that outlived their usefulness (a card that never got reviewed, say)."""
    cutoff = timezone.now() - timezone.timedelta(days=settings.GIFTCARD_CODE_RETENTION_DAYS)
    return GiftCardSubmission.objects.exclude(card_code_encrypted="").filter(submitted_at__lt=cutoff).update(
        card_code_encrypted="", code_wiped_at=timezone.now()
    )
