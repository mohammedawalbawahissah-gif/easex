from decimal import Decimal

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.notifications.models import Notification

from . import ledger
from .models import Transaction

T = Transaction.TransactionType
S = Transaction.Status

# Title + body template per status. body_template gets `.format(type=...)`
# with a human-readable transaction type name.
STATUS_MESSAGES = {
    S.UNDER_REVIEW: (
        "Submission received",
        "We're reviewing your {type}.",
    ),
    S.VERIFIED: (
        "Verified",
        "Your {type} has been verified and is queued for payout.",
    ),
    S.SETTLED: (
        "Payout complete",
        "Your {type} has been paid out.",
    ),
    S.REJECTED: (
        "Rejected",
        "Your {type} was rejected. Contact support if you think this is a mistake.",
    ),
    S.FLAGGED: (
        "Flagged for review",
        "Your {type} has been flagged for a closer compliance review.",
    ),
}

TYPE_LABELS = {
    T.CRYPTO_DEPOSIT: "crypto deposit",
    T.CRYPTO_TRADE: "crypto trade",
    T.GIFTCARD_SALE: "gift card sale",
    T.FIAT_PAYOUT: "payout",
    T.WALLET_LOAD: "wallet load",
    T.CRYPTO_WITHDRAWAL: "crypto withdrawal",
    T.TRANSFER_OUT: "transfer",
    T.TRANSFER_IN: "transfer",
}


def format_amount(amount, currency) -> str:
    value = Decimal(str(amount))
    if currency == "GHS":
        return f"{value:,.2f} GHS"
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return f"{text} {currency}"


def build_message(txn: Transaction):
    """(title, body) for this transaction's current status, or None."""
    label = TYPE_LABELS.get(txn.transaction_type, "transaction")
    amount = format_amount(txn.amount, txn.currency)
    meta = txn.metadata or {}
    who = meta.get("counterparty_username")

    # --- type-specific wording where the generic text would be wrong ---
    if txn.status == S.SETTLED:
        if txn.transaction_type == T.CRYPTO_TRADE:
            return ("Trade complete", f"Your {label} has gone through.")
        if txn.transaction_type == T.GIFTCARD_SALE:
            return ("Payment received", f"Your gift card sale of {amount} has been added to your wallet.")
        if txn.transaction_type == T.WALLET_LOAD:
            return ("Wallet funded", f"{amount} was added to your wallet.")
        if txn.transaction_type == T.TRANSFER_OUT:
            return ("Transfer sent", f"You sent {amount}" + (f" to @{who}." if who else "."))
        if txn.transaction_type == T.TRANSFER_IN:
            return ("Money received", f"You received {amount}" + (f" from @{who}." if who else "."))
        if txn.transaction_type == T.CRYPTO_DEPOSIT:
            return ("Deposit received", f"{amount} was added to your wallet.")
        if txn.transaction_type in ledger.WITHDRAWAL_TYPES:
            return ("Withdrawal complete", f"Your withdrawal of {amount} has been sent.")

    if txn.status == S.REJECTED and txn.transaction_type in ledger.WITHDRAWAL_TYPES:
        reason = meta.get("failure_reason") or meta.get("rejection_reason")
        released = meta.get(ledger.HOLD_KEY) == ledger.HOLD_RELEASED
        body = f"Your withdrawal of {amount} didn't go through"
        body += " and the funds are back in your wallet." if released else "."
        if reason:
            body += f" Reason: {reason}"
        return ("Withdrawal not completed", body)

    if txn.status == S.REJECTED and txn.transaction_type == T.WALLET_LOAD:
        return ("Wallet load not completed", f"We couldn't complete your wallet load of {amount}.")

    generic = STATUS_MESSAGES.get(txn.status)
    if not generic:
        return None
    title, body_template = generic
    return (title, body_template.format(type=label))


@receiver(pre_save, sender=Transaction)
def before_transaction_save(sender, instance, **kwargs):
    """
    Three jobs, sharing one locked lookup of the previous row:

    1. Stash the old status on the instance so post_save can tell whether
       this save is a real status transition (used for notifications).
    2. Refuse to move a transaction OUT of a terminal state. Without this,
       a settled transaction could be re-opened and settled again — a
       second credit for the same money.
    3. Turn a status transition into money movement (via ledger.py) — the
       only place that happens. SETTLED applies the effect; REJECTED gives
       back any hold.

    The previous row is read with SELECT ... FOR UPDATE, so two admins
    clicking "settle" at the same moment serialise: the second one sees
    SETTLED and does nothing instead of crediting twice.
    """
    if instance._state.adding:
        instance._old_status = None
        return

    ledger.require_atomic()

    try:
        previous = Transaction.objects.select_for_update(no_key=True).get(pk=instance.pk)
    except Transaction.DoesNotExist:
        instance._old_status = None
        return

    instance._old_status = previous.status

    if previous.status == instance.status:
        return  # unrelated save (e.g. metadata edit) — no money moves

    if previous.status in ledger.TERMINAL_STATUSES:
        raise ledger.InvalidTransition(
            f"Transaction {instance.pk} is {previous.status} and can't be changed to {instance.status}."
        )

    if instance.status == S.SETTLED:
        ledger.apply_settlement(instance)
    elif instance.status == S.REJECTED:
        ledger.apply_rejection(instance)


@receiver(post_save, sender=Transaction)
def notify_on_status_change(sender, instance, created, **kwargs):
    """
    Fires a Notification whenever a transaction reaches a status the
    user actually cares about. Skips the uninteresting initial
    'pending' state on creation (crypto trades default to this) but
    DOES notify on creation when a submission starts straight at
    'under_review' — that's the "we got it" confirmation.
    """
    old_status = getattr(instance, "_old_status", None)

    if not created and old_status == instance.status:
        return  # saved for an unrelated reason (e.g. metadata edit)

    if created and instance.status == S.PENDING:
        return  # nothing worth telling the user yet

    message = build_message(instance)
    if not message:
        return

    title, body = message
    Notification.objects.create(
        user=instance.user,
        category=Notification.Category.TRANSACTION_UPDATE,
        title=title,
        body=body,
        related_type="transaction",
        related_id=str(instance.pk),
    )
