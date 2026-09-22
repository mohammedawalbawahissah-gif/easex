"""
Payments service layer: load, withdraw, transfer, schedule, auto-payout.

Every function that moves value follows the same shape, and the order
matters:

  1. `transaction.atomic()` — all-or-nothing.
  2. Lock the USER row first (SELECT ... FOR UPDATE). This serialises a
     user's own money operations, so two simultaneous requests can't both
     pass the same daily-limit check, and duplicate submissions (the
     idempotency check) can't race each other.
  3. Lock the WALLET rows in a fixed (primary-key) order. Two users
     sending to each other at the same moment can't deadlock, because
     everyone acquires wallet locks in the same order.
  4. Check limits/balances — now reliable, because of the locks.
  5. Change balances only through apps.transactions.ledger.

Slow or fallible calls to the outside world (payment providers) happen
OUTSIDE those transactions, so no database lock is ever held while
waiting on the network.
"""

import logging
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.compliance.models import AuditLog, ComplianceFlag
from apps.notifications.models import Notification
from apps.transactions import ledger
from apps.transactions.models import Transaction
from apps.security import services as security_services
from apps.wallets.models import Wallet

from . import limits
from .currencies import (
    CRYPTO_CURRENCIES,
    CRYPTO_NETWORKS,
    FIAT_CURRENCY,
    MEMO_NETWORKS,
    MOBILE_MONEY_NETWORKS,
    has_valid_precision,
    is_valid_address,
    normalize_gh_phone,
)
from .models import (
    DepositAddress,
    PaymentSettings,
    PayoutDestination,
    PayoutPreference,
    ScheduledLoad,
    ScheduledTransfer,
    ScheduledWithdrawal,
)
from .providers import ProviderResult, ProviderUnavailable, get_provider

logger = logging.getLogger(__name__)
User = get_user_model()

T = Transaction.TransactionType
S = Transaction.Status

MAX_ACTIVE_SCHEDULED = 20
MAX_ACTIVE_DESTINATIONS = 5
MIN_SCHEDULE_LEAD = timedelta(seconds=60)
MAX_SCHEDULE_HORIZON = timedelta(days=365)
# If the scheduler was down for longer than this, don't run a transfer
# that is now stale — fail it and tell the user rather than surprise them.
MAX_SCHEDULE_LATENESS = timedelta(hours=6)


class PaymentError(Exception):
    """A problem the user can act on. `code` lets clients branch if they want."""

    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.message = message
        self.code = code


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _namespaced_key(user, key: str) -> str:
    # Keys are unique across the whole table; prefixing with the user makes
    # one user's key unable to collide with (or probe) another's.
    return f"{user.pk}:{key}"


def _lock_user(user):
    # FOR NO KEY UPDATE, not plain FOR UPDATE: inserting a transaction row
    # for a user takes a FOR KEY SHARE lock on that user's row (foreign-key
    # check). Plain FOR UPDATE conflicts with it, so two people paying each
    # other at the same moment deadlocked. NO KEY UPDATE still serialises a
    # user's own operations but lets other users' inserts through.
    locked = User.objects.select_for_update(no_key=True).get(pk=user.pk)
    if not locked.is_active:
        raise PaymentError("This account is disabled.", "account_disabled")
    return locked


def _require_verified(user, action: str):
    if user.daily_limit() <= 0:
        raise PaymentError(f"Verify your account to {action}.", "kyc_required")


def _require_can_send(user, action: str = "send money"):
    if user.is_flagged:
        raise PaymentError(
            "Your account is under review, so money can't leave it right now. Please contact support.",
            "account_flagged",
        )
    until = security_services.cooling_off_until(user)
    if until:
        raise PaymentError(
            "For your security, money can't leave your account for a while after a password reset or a PIN / "
            f"2FA change. You can send again from {until:%d %b %Y, %H:%M} UTC.",
            "cooling_off",
        )
    _require_verified(user, action)


def _validate_amount(currency: str, raw) -> Decimal:
    valid = {c for c, _ in Wallet.Currency.choices}
    if currency not in valid:
        raise PaymentError("Unsupported currency.")
    try:
        amount = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise PaymentError("Enter a valid amount.")
    if not amount.is_finite() or amount <= 0:
        raise PaymentError("Enter an amount greater than 0.")
    if not has_valid_precision(amount, currency):
        places = 2 if currency == FIAT_CURRENCY else 8
        raise PaymentError(f"{currency} amounts can have at most {places} decimal places.")
    return amount


def _get_wallet(user, currency: str) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(user=user, currency=currency)
    return wallet


def _lock_wallets(*wallets) -> dict:
    """Lock wallet rows in primary-key order (deadlock-free); returns {pk: locked wallet}."""
    ids = sorted({w.pk for w in wallets}, key=str)
    locked = list(Wallet.objects.select_for_update(no_key=True).filter(pk__in=ids).order_by("pk"))
    return {w.pk: w for w in locked}


def _ghs_value(currency: str, amount: Decimal) -> Decimal:
    try:
        return limits.ghs_value(currency, amount)
    except limits.UnpriceableAsset:
        raise PaymentError(f"{currency} isn't available for this right now.", "unpriceable")


def _check_outgoing_limit(user, ghs: Decimal):
    remaining = limits.outgoing_remaining(user)
    if ghs > remaining:
        raise PaymentError(
            f"This would exceed your daily limit. You can still send up to {remaining:,.2f} GHS "
            f"(or equivalent) in the next 24 hours.",
            "limit_exceeded",
        )


def _audit(actor, action: str, target_model: str, target_id, **details):
    AuditLog.objects.create(
        actor=actor,
        action=action,
        target_model=target_model,
        target_id=str(target_id),
        details={k: (str(v) if isinstance(v, Decimal) else v) for k, v in details.items()},
    )


def _notify(user, title: str, body: str, category=Notification.Category.SYSTEM):
    Notification.objects.create(user=user, category=category, title=title, body=body)


def _dispatch_withdrawal(txn_id):
    """Queue the provider call for after the surrounding DB transaction commits."""

    def _send():
        from .tasks import execute_withdrawal

        try:
            execute_withdrawal.delay(str(txn_id))
        except Exception:  # broker down — sweeper task will pick it up
            logger.exception("Couldn't queue withdrawal %s; sweeper will retry", txn_id)

    transaction.on_commit(_send)


# ---------------------------------------------------------------------------
# Loading the wallet
# ---------------------------------------------------------------------------


def create_wallet_load(*, user, amount, network: str, phone_number: str, idempotency_key: str):
    """
    Add GHS to the wallet via mobile money. Returns (transaction, created).

    With the manual provider this creates a request that waits for an admin
    to confirm the money arrived. With a real gateway it triggers the
    payment prompt on the user's phone and settles when confirmed.
    """
    ps = PaymentSettings.get()
    if not ps.loads_enabled:
        raise PaymentError("Adding money is temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(FIAT_CURRENCY, amount)
    if network not in MOBILE_MONEY_NETWORKS:
        raise PaymentError("Choose a mobile money network.")
    phone = normalize_gh_phone(phone_number)
    if not phone:
        raise PaymentError("Enter a valid Ghana mobile money number.")

    key = _namespaced_key(user, idempotency_key)
    with transaction.atomic():
        user = _lock_user(user)
        existing = Transaction.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False

        _require_verified(user, "add money")
        remaining = limits.loads_remaining(user)
        if amount > remaining:
            raise PaymentError(
                f"This would exceed your daily limit. You can add up to {remaining:,.2f} GHS in the next 24 hours.",
                "limit_exceeded",
            )

        reference = "EX-" + uuid.uuid4().hex[:8].upper()
        txn = Transaction.objects.create(
            user=user,
            wallet=_get_wallet(user, FIAT_CURRENCY),
            transaction_type=T.WALLET_LOAD,
            status=S.PENDING,
            amount=amount,
            currency=FIAT_CURRENCY,
            idempotency_key=key,
            ghs_value=amount,
            metadata={
                "reference": reference,
                "method": "mobile_money",
                "network": network,
                "phone_number": phone,
            },
        )

    # --- outside the DB transaction: talk to the provider ---
    provider = get_provider()
    try:
        result = provider.start_collection(
            reference=reference, amount=amount, network=network, phone_number=phone
        )
    except Exception:
        logger.exception("start_collection failed for %s", txn.pk)
        result = ProviderResult("pending", reference=reference, message="Provider did not respond", needs_admin=True)

    return apply_collection_result(txn.pk, result), True


def apply_collection_result(txn_id, result: ProviderResult) -> Transaction:
    ps = PaymentSettings.get()
    with transaction.atomic():
        txn = Transaction.objects.select_for_update(no_key=True).get(pk=txn_id)
        if txn.status != S.PENDING:
            return txn

        if result.status == "settled":
            txn.external_reference = result.reference
            txn.status = S.SETTLED
        elif result.status == "failed":
            txn.metadata["failure_reason"] = result.message or "The payment wasn't completed."
            txn.status = S.REJECTED
        else:  # pending
            txn.external_reference = result.reference or txn.external_reference
            if result.needs_admin:
                txn.metadata["instructions"] = ps.manual_deposit_instructions
                txn.status = S.UNDER_REVIEW
        txn.save()
        return txn


def get_deposit_address(*, user, currency: str, network: str) -> DepositAddress:
    """The user's dedicated on-chain deposit address for an asset+network."""
    if currency not in CRYPTO_CURRENCIES:
        raise PaymentError("Choose a cryptocurrency to deposit.")
    if network not in CRYPTO_NETWORKS.get(currency, []):
        raise PaymentError(f"{currency} can't be deposited on that network.")
    if not user.is_active:
        raise PaymentError("This account is disabled.", "account_disabled")
    _require_verified(user, "deposit crypto")
    if not PaymentSettings.get().loads_enabled:
        raise PaymentError("Deposits are temporarily unavailable. Please try again later.", "paused")

    existing = DepositAddress.objects.filter(user=user, currency=currency, network=network).first()
    if existing:
        return existing
    try:
        info = get_provider().get_deposit_info(user_id=str(user.pk), currency=currency, network=network)
    except ProviderUnavailable as exc:
        raise PaymentError(str(exc), "unavailable")
    obj, _ = DepositAddress.objects.get_or_create(
        user=user,
        currency=currency,
        network=network,
        defaults={"address": info.address, "memo": info.memo},
    )
    return obj


def credit_crypto_deposit(*, user, currency: str, amount, network: str, tx_hash: str) -> Transaction:
    """
    Record an on-chain deposit that has been confirmed. This is what a
    provider webhook (or the dev `simulate_deposit` command) calls.
    Idempotent on (network, tx_hash): the same on-chain transaction can
    never be credited twice.
    """
    amount = _validate_amount(currency, amount)
    if currency not in CRYPTO_CURRENCIES:
        raise PaymentError("Not a cryptocurrency.")
    key = f"dep:{network}:{tx_hash}"[:100]
    with transaction.atomic():
        existing = Transaction.objects.filter(idempotency_key=key).first()
        if existing:
            return existing
        wallet = _get_wallet(user, currency)
        _lock_wallets(wallet)
        txn = Transaction.objects.create(
            user=user,
            wallet=wallet,
            transaction_type=T.CRYPTO_DEPOSIT,
            status=S.PENDING,
            amount=amount,
            currency=currency,
            idempotency_key=key,
            external_reference=tx_hash,
            metadata={"network": network},
        )
        txn.status = S.SETTLED
        txn.save()
        return txn


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------


def request_withdrawal(
    *,
    user,
    currency: str,
    amount,
    idempotency_key: str,
    destination_id=None,
    address: str = "",
    network: str = "",
    memo: str = "",
    source: str = "user",
    pre_approved: bool = False,
):
    """
    Request a withdrawal. The funds are HELD immediately (balance -> escrow)
    so they can't be spent twice, then either wait for an admin
    (UNDER_REVIEW) or, if within the auto-approve threshold, go straight
    to the provider (VERIFIED). Returns (transaction, created).

    `pre_approved` is only for system callers that have already been
    authorised by a human decision (gift card auto-payout).
    """
    ps = PaymentSettings.get()
    if not ps.withdrawals_enabled:
        raise PaymentError("Withdrawals are temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(currency, amount)
    is_fiat = currency == FIAT_CURRENCY

    key = _namespaced_key(user, idempotency_key)
    with transaction.atomic():
        user = _lock_user(user)
        existing = Transaction.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False

        _require_can_send(user, "withdraw")

        if is_fiat:
            destination = PayoutDestination.objects.filter(
                pk=destination_id, user=user, is_active=True
            ).first() if destination_id else None
            if not destination:
                raise PaymentError("Choose where to send your money.")
            snapshot = destination.as_snapshot()
        else:
            if network not in CRYPTO_NETWORKS.get(currency, []):
                raise PaymentError(f"{currency} can't be withdrawn on that network.")
            address = (address or "").strip()
            if not is_valid_address(network, address):
                raise PaymentError(
                    "That doesn't look like a valid address for this network. Check it carefully — "
                    "crypto sent to a wrong address can't be recovered."
                )
            memo = (memo or "").strip()
            if memo and network not in MEMO_NETWORKS:
                raise PaymentError("This network doesn't use a memo or tag.")
            if memo and not memo.isdigit():
                raise PaymentError("The destination tag must be a number.")
            snapshot = {"kind": "crypto", "network": network, "address": address, "memo": memo}

        ghs = _ghs_value(currency, amount)
        _check_outgoing_limit(user, ghs)

        wallet = _get_wallet(user, currency)
        _lock_wallets(wallet)
        try:
            ledger.hold(wallet.pk, amount)
        except ledger.InsufficientFunds:
            raise PaymentError("Insufficient balance.", "insufficient_funds")

        auto_approved = pre_approved or (
            ps.withdrawal_auto_approve_max_ghs > 0 and ghs <= ps.withdrawal_auto_approve_max_ghs
        )
        txn = Transaction.objects.create(
            user=user,
            wallet=wallet,
            transaction_type=T.FIAT_PAYOUT if is_fiat else T.CRYPTO_WITHDRAWAL,
            status=S.VERIFIED if auto_approved else S.UNDER_REVIEW,
            amount=amount,
            currency=currency,
            idempotency_key=key,
            ghs_value=ghs,
            verified_at=timezone.now() if auto_approved else None,
            metadata={
                ledger.HOLD_KEY: ledger.HOLD_HELD,
                "destination": snapshot,
                "source": source,
                "auto_approved": bool(auto_approved),
            },
        )
        if auto_approved:
            _dispatch_withdrawal(txn.pk)
        return txn, True


def execute_withdrawal(txn_id):
    """
    Send an approved (VERIFIED) withdrawal through the provider.

    The `dispatched_at` marker is committed BEFORE the provider is called,
    so if anything goes wrong afterwards this function will never blindly
    send a second time. An exception from the provider means "we don't
    know if it went through" — that is parked for a human to reconcile
    rather than retried, because retrying could pay twice.
    """
    with transaction.atomic():
        txn = Transaction.objects.select_for_update(no_key=True).get(pk=txn_id)
        if txn.status != S.VERIFIED or txn.transaction_type not in ledger.WITHDRAWAL_TYPES:
            return txn
        if txn.metadata.get("dispatched_at"):
            return txn
        txn.metadata["dispatched_at"] = timezone.now().isoformat()
        txn.save(update_fields=["metadata", "updated_at"])

    provider = get_provider()
    dest = txn.metadata.get("destination", {})
    try:
        if txn.currency == FIAT_CURRENCY:
            result = provider.send_fiat_payout(reference=str(txn.pk), amount=txn.amount, destination=dest)
        else:
            result = provider.send_crypto(
                reference=str(txn.pk),
                currency=txn.currency,
                network=dest.get("network", ""),
                amount=txn.amount,
                address=dest.get("address", ""),
                memo=dest.get("memo", ""),
            )
    except Exception:
        logger.exception("Provider call for withdrawal %s raised; needs manual reconciliation", txn_id)
        flag_for_reconciliation(txn_id, "The payment provider didn't respond. Check the provider dashboard before retrying.")
        return Transaction.objects.get(pk=txn_id)

    return finalize_withdrawal(txn_id, result)


def finalize_withdrawal(txn_id, result: ProviderResult) -> Transaction:
    """Apply a provider's outcome. Also what a webhook would call."""
    with transaction.atomic():
        txn = Transaction.objects.select_for_update(no_key=True).get(pk=txn_id)
        if txn.status != S.VERIFIED:
            return txn

        if result.status == "settled":
            txn.external_reference = result.reference or txn.external_reference
            txn.status = S.SETTLED
            txn.save()  # signal releases the hold to the outside world
        elif result.status == "failed":
            txn.metadata["failure_reason"] = result.message or "The payout was declined."
            txn.status = S.REJECTED
            txn.save()  # signal returns the held funds to the wallet
        else:
            txn.external_reference = result.reference or txn.external_reference
            txn.metadata["provider_state"] = "pending"
            txn.save(update_fields=["metadata", "external_reference", "updated_at"])
        return txn


def flag_for_reconciliation(txn_id, note: str):
    with transaction.atomic():
        txn = Transaction.objects.select_for_update(no_key=True).get(pk=txn_id)
        txn.metadata["needs_reconciliation"] = True
        txn.metadata["reconciliation_note"] = note
        txn.save(update_fields=["metadata", "updated_at"])


def dispatch_stuck_withdrawals() -> int:
    """
    Sweeper: approved withdrawals that were never handed to the provider
    (e.g. the broker was down at approval time). Safe to run repeatedly —
    execute_withdrawal refuses anything already dispatched.
    """
    from .tasks import execute_withdrawal as task

    cutoff = timezone.now() - timedelta(minutes=2)
    ids = [
        str(pk)
        for pk in Transaction.objects.filter(
            transaction_type__in=ledger.WITHDRAWAL_TYPES,
            status=S.VERIFIED,
            updated_at__lt=cutoff,
        )
        .exclude(metadata__has_key="dispatched_at")
        .values_list("pk", flat=True)[:100]
    ]
    for txn_id in ids:
        task.delay(txn_id)
    return len(ids)


# ---------------------------------------------------------------------------
# Payout destinations & auto-payout preference
# ---------------------------------------------------------------------------


def add_destination(*, user, network: str, account_number: str, account_name: str) -> PayoutDestination:
    if network not in MOBILE_MONEY_NETWORKS:
        raise PaymentError("Choose a mobile money network.")
    number = normalize_gh_phone(account_number)
    if not number:
        raise PaymentError("Enter a valid Ghana mobile money number.")
    name = (account_name or "").strip()
    if len(name) < 2:
        raise PaymentError("Enter the name on the account.")

    with transaction.atomic():
        user = _lock_user(user)
        if user.payout_destinations.filter(is_active=True).count() >= MAX_ACTIVE_DESTINATIONS:
            raise PaymentError(f"You can save up to {MAX_ACTIVE_DESTINATIONS} payout accounts. Remove one first.")
        if user.payout_destinations.filter(
            is_active=True, network=network, account_number=number
        ).exists():
            raise PaymentError("That account is already saved.")
        dest = PayoutDestination.objects.create(
            user=user, network=network, account_number=number, account_name=name
        )
        _audit(user, "payout_destination_added", "PayoutDestination", dest.pk, network=network)
    _notify(
        user,
        "Payout account added",
        f"{MOBILE_MONEY_NETWORKS[network]} ••••{number[-4:]} was added to your account. "
        "If this wasn't you, change your password and contact support.",
    )
    return dest


def remove_destination(*, user, destination_id):
    with transaction.atomic():
        user = _lock_user(user)
        dest = PayoutDestination.objects.filter(pk=destination_id, user=user, is_active=True).first()
        if not dest:
            raise PaymentError("That payout account wasn't found.", "not_found")
        dest.is_active = False
        dest.save(update_fields=["is_active"])
        pref = PayoutPreference.objects.filter(user=user, destination=dest).first()
        if pref:
            pref.destination = None
            pref.auto_payout_enabled = False
            pref.save()
        _audit(user, "payout_destination_removed", "PayoutDestination", dest.pk)


def set_auto_payout(*, user, enabled: bool, destination_id=None) -> PayoutPreference:
    with transaction.atomic():
        user = _lock_user(user)
        pref, _ = PayoutPreference.objects.get_or_create(user=user)
        if enabled:
            dest = PayoutDestination.objects.filter(
                pk=destination_id, user=user, is_active=True
            ).first() if destination_id else None
            if not dest:
                raise PaymentError("Choose a payout account to send your gift card earnings to.")
            pref.destination = dest
            pref.auto_payout_enabled = True
        else:
            pref.auto_payout_enabled = False
        pref.save()
        _audit(user, "auto_payout_changed", "PayoutPreference", pref.pk, enabled=enabled)
    _notify(
        user,
        "Automatic payouts " + ("turned on" if enabled else "turned off"),
        (
            "Approved gift card sales will now be sent to your saved account automatically."
            if enabled
            else "Approved gift card sales will stay in your wallet until you withdraw them."
        )
        + " If you didn't do this, change your password and contact support.",
    )
    return pref


def auto_payout_for_giftcard(*, user, amount: Decimal, submission_id) -> dict:
    """
    After a gift card sale has been credited, optionally send it on to the
    seller's saved mobile money account. NEVER raises for a business reason:
    the wallet credit already happened and must stand. Returns
    {"status": "sent" | "skipped", "reason": str, "transaction": str | None}.
    """
    ps = PaymentSettings.get()

    def skipped(reason: str, notify: bool = True):
        if notify:
            _notify(
                user,
                "Your earnings are in your wallet",
                f"We didn't send your gift card payment to your payout account automatically ({reason}). "
                "You can withdraw it from your wallet whenever you like.",
                Notification.Category.TRANSACTION_UPDATE,
            )
        return {"status": "skipped", "reason": reason, "transaction": None}

    pref = PayoutPreference.objects.select_related("destination").filter(user=user).first()
    if not pref or not pref.auto_payout_enabled:
        return skipped("seller has not opted in", notify=False)

    dest = pref.destination
    if not dest or not dest.is_active:
        return skipped("payout account no longer available")
    if ps.giftcard_auto_payout_max_ghs <= 0 or amount > ps.giftcard_auto_payout_max_ghs:
        return skipped("amount is above the automatic payout limit")
    cooldown = timedelta(hours=ps.auto_payout_destination_cooldown_hours)
    if dest.created_at > timezone.now() - cooldown:
        return skipped("your payout account was added recently")
    if user.is_flagged or ComplianceFlag.objects.filter(
        user=user, status__in=[ComplianceFlag.Status.OPEN, ComplianceFlag.Status.REVIEWING]
    ).exists():
        return skipped("your account needs a quick review")

    try:
        txn, _ = request_withdrawal(
            user=user,
            currency=FIAT_CURRENCY,
            amount=amount,
            idempotency_key=f"gcauto-{submission_id}",
            destination_id=dest.pk,
            source="giftcard_auto",
            pre_approved=True,
        )
    except PaymentError as exc:
        return skipped(exc.message.rstrip("."))
    return {"status": "sent", "reason": "", "transaction": str(txn.pk)}


# ---------------------------------------------------------------------------
# Transfers between EaseX users
# ---------------------------------------------------------------------------


def _phone_candidates(raw: str) -> set:
    digits = "".join(ch for ch in raw if ch.isdigit())
    out = {raw.strip(), digits, "+" + digits}
    if digits.startswith("0") and len(digits) == 10:
        intl = "233" + digits[1:]
        out |= {intl, "+" + intl}
    elif digits.startswith("233") and len(digits) == 12:
        local = "0" + digits[3:]
        out |= {local}
    return out


def find_recipient(identifier: str, *, exclude=None):
    """Resolve a username or phone number to an active user, or None."""
    identifier = (identifier or "").strip().lstrip("@")
    if not identifier:
        return None
    qs = User.objects.filter(is_active=True)
    if exclude is not None:
        qs = qs.exclude(pk=exclude.pk)
    looks_like_phone = sum(ch.isdigit() for ch in identifier) >= 9 and not any(
        ch.isalpha() for ch in identifier
    )
    if looks_like_phone:
        return qs.filter(phone_number__in=_phone_candidates(identifier)).first()
    return qs.filter(username__iexact=identifier).first()


def mask_username(username: str) -> str:
    if len(username) <= 2:
        return username[0] + "•••"
    if len(username) <= 4:
        return username[0] + "•••" + username[-1]
    return username[:2] + "•••" + username[-1]


def _validate_recipient(sender, recipient):
    if recipient is None or not recipient.is_active:
        raise PaymentError("We couldn't find that person. Check the username or phone number.", "recipient_not_found")
    if recipient.pk == sender.pk:
        raise PaymentError("You can't send money to yourself.")


def execute_transfer(*, sender, recipient, currency: str, amount, note: str, idempotency_key: str):
    """
    Move `amount` of `currency` from sender to recipient, instantly and
    atomically, as two linked ledger rows (one visible to each person).
    Returns (sender_transaction, created).
    """
    ps = PaymentSettings.get()
    if not ps.transfers_enabled:
        raise PaymentError("Transfers are temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(currency, amount)
    note = (note or "").strip()[:140]

    key_base = _namespaced_key(sender, idempotency_key)
    key_out, key_in = f"{key_base}:out", f"{key_base}:in"

    with transaction.atomic():
        sender = _lock_user(sender)
        existing = Transaction.objects.filter(idempotency_key=key_out).first()
        if existing:
            return existing, False

        _require_can_send(sender, "send money")
        _validate_recipient(sender, recipient)

        ghs = _ghs_value(currency, amount)
        _check_outgoing_limit(sender, ghs)

        sender_wallet = _get_wallet(sender, currency)
        recipient_wallet = _get_wallet(recipient, currency)
        locked = _lock_wallets(sender_wallet, recipient_wallet)
        if locked[sender_wallet.pk].balance < amount:
            raise PaymentError("Insufficient balance.", "insufficient_funds")

        out_txn = Transaction.objects.create(
            user=sender,
            wallet=sender_wallet,
            transaction_type=T.TRANSFER_OUT,
            status=S.PENDING,
            amount=amount,
            currency=currency,
            idempotency_key=key_out,
            ghs_value=ghs,
            metadata={"counterparty_username": recipient.username, "note": note},
        )
        in_txn = Transaction.objects.create(
            user=recipient,
            wallet=recipient_wallet,
            transaction_type=T.TRANSFER_IN,
            status=S.PENDING,
            amount=amount,
            currency=currency,
            idempotency_key=key_in,
            ghs_value=ghs,
            metadata={"counterparty_username": sender.username, "note": note, "peer": str(out_txn.pk)},
        )
        out_txn.metadata["peer"] = str(in_txn.pk)

        try:
            out_txn.status = S.SETTLED
            out_txn.save()  # signal: guarded debit of the sender
            in_txn.status = S.SETTLED
            in_txn.save()  # signal: credit of the recipient
        except ledger.InsufficientFunds:
            raise PaymentError("Insufficient balance.", "insufficient_funds")
        return out_txn, True


# ---------------------------------------------------------------------------
# Scheduled transfers
# ---------------------------------------------------------------------------


def schedule_transfer(*, user, recipient, currency: str, amount, run_at, note: str, idempotency_key: str):
    ps = PaymentSettings.get()
    if not ps.transfers_enabled:
        raise PaymentError("Transfers are temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(currency, amount)
    note = (note or "").strip()[:140]

    key = _namespaced_key(user, idempotency_key)
    with transaction.atomic():
        user = _lock_user(user)
        existing = ScheduledTransfer.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False

        _require_can_send(user, "schedule transfers")
        _validate_recipient(user, recipient)

        now = timezone.now()
        if run_at < now + MIN_SCHEDULE_LEAD:
            raise PaymentError("Choose a time at least a minute in the future.")
        if run_at > now + MAX_SCHEDULE_HORIZON:
            raise PaymentError("You can schedule up to a year ahead.")

        # A single transfer bigger than the whole daily limit could never run.
        ghs = _ghs_value(currency, amount)
        if ghs > Decimal(user.daily_limit()):
            raise PaymentError(
                f"That's above your {user.daily_limit():,} GHS daily limit, so it couldn't be sent. "
                "Verify your account to raise the limit.",
                "limit_exceeded",
            )

        active = ScheduledTransfer.objects.filter(user=user, status=ScheduledTransfer.Status.SCHEDULED).count()
        if active >= MAX_ACTIVE_SCHEDULED:
            raise PaymentError(f"You can have up to {MAX_ACTIVE_SCHEDULED} scheduled transfers at a time.")

        obj = ScheduledTransfer.objects.create(
            user=user,
            recipient=recipient,
            currency=currency,
            amount=amount,
            note=note,
            run_at=run_at,
            idempotency_key=key,
        )
        _audit(user, "transfer_scheduled", "ScheduledTransfer", obj.pk, currency=currency, amount=amount)
        return obj, True


def cancel_scheduled_transfer(*, user, scheduled_id) -> ScheduledTransfer:
    with transaction.atomic():
        st = (
            ScheduledTransfer.objects.select_for_update(no_key=True)
            .filter(pk=scheduled_id, user=user)
            .first()
        )
        if not st:
            raise PaymentError("That scheduled transfer wasn't found.", "not_found")
        if st.status != ScheduledTransfer.Status.SCHEDULED:
            raise PaymentError("This transfer can no longer be cancelled.", "not_cancellable")
        st.status = ScheduledTransfer.Status.CANCELLED
        st.save(update_fields=["status"])
        return st


def _fail_scheduled(st: ScheduledTransfer, reason: str):
    st.status = ScheduledTransfer.Status.FAILED
    st.failure_reason = reason[:200]
    st.executed_at = timezone.now()
    st.save()
    _notify(
        st.user,
        "Scheduled transfer didn't go through",
        f"Your scheduled transfer of {st.amount.normalize():f} {st.currency} to @{st.recipient.username} "
        f"couldn't be sent: {reason}",
        Notification.Category.TRANSACTION_UPDATE,
    )


def process_scheduled_transfer(scheduled_id):
    """Run one due scheduled transfer. Safe to call concurrently / repeatedly."""
    with transaction.atomic():
        st = (
            ScheduledTransfer.objects.select_for_update(skip_locked=True, no_key=True, of=("self",))
            .select_related("user", "recipient")
            .filter(
                pk=scheduled_id,
                status=ScheduledTransfer.Status.SCHEDULED,
                run_at__lte=timezone.now(),
            )
            .first()
        )
        if not st:
            return None

        if timezone.now() - st.run_at > MAX_SCHEDULE_LATENESS:
            _fail_scheduled(st, "it couldn't run at the scheduled time")
            return st

        try:
            with transaction.atomic():  # savepoint: a failed attempt leaves no partial writes
                out_txn, _ = execute_transfer(
                    sender=st.user,
                    recipient=st.recipient,
                    currency=st.currency,
                    amount=st.amount,
                    note=st.note,
                    idempotency_key=f"sched-{st.pk}",
                )
        except PaymentError as exc:
            _fail_scheduled(st, exc.message.rstrip("."))
            return st

        st.status = ScheduledTransfer.Status.COMPLETED
        st.transaction = out_txn
        st.executed_at = timezone.now()
        st.save()
        return st


def run_due_scheduled_transfers() -> int:
    ids = list(
        ScheduledTransfer.objects.filter(
            status=ScheduledTransfer.Status.SCHEDULED, run_at__lte=timezone.now()
        )
        .order_by("run_at")
        .values_list("pk", flat=True)[:100]
    )
    for pk in ids:
        try:
            process_scheduled_transfer(pk)
        except Exception:
            logger.exception("Scheduled transfer %s crashed", pk)
    return len(ids)


# ---------------------------------------------------------------------------
# Scheduled wallet loads
# ---------------------------------------------------------------------------


def schedule_wallet_load(*, user, amount, network: str, phone_number: str, run_at, idempotency_key: str):
    ps = PaymentSettings.get()
    if not ps.loads_enabled:
        raise PaymentError("Adding money is temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(FIAT_CURRENCY, amount)
    if network not in MOBILE_MONEY_NETWORKS:
        raise PaymentError("Choose a mobile money network.")
    phone = normalize_gh_phone(phone_number)
    if not phone:
        raise PaymentError("Enter a valid Ghana mobile money number.")

    key = _namespaced_key(user, idempotency_key)
    with transaction.atomic():
        user = _lock_user(user)
        existing = ScheduledLoad.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False

        _require_verified(user, "schedule a wallet load")

        now = timezone.now()
        if run_at < now + MIN_SCHEDULE_LEAD:
            raise PaymentError("Choose a time at least a minute in the future.")
        if run_at > now + MAX_SCHEDULE_HORIZON:
            raise PaymentError("You can schedule up to a year ahead.")

        active = ScheduledLoad.objects.filter(user=user, status=ScheduledLoad.Status.SCHEDULED).count()
        if active >= MAX_ACTIVE_SCHEDULED:
            raise PaymentError(f"You can have up to {MAX_ACTIVE_SCHEDULED} scheduled loads at a time.")

        obj = ScheduledLoad.objects.create(
            user=user,
            amount=amount,
            network=network,
            phone_number=phone,
            run_at=run_at,
            idempotency_key=key,
        )
        _audit(user, "load_scheduled", "ScheduledLoad", obj.pk, amount=amount)
        return obj, True


def cancel_scheduled_load(*, user, scheduled_id) -> ScheduledLoad:
    with transaction.atomic():
        sl = ScheduledLoad.objects.select_for_update(no_key=True).filter(pk=scheduled_id, user=user).first()
        if not sl:
            raise PaymentError("That scheduled load wasn't found.", "not_found")
        if sl.status != ScheduledLoad.Status.SCHEDULED:
            raise PaymentError("This load can no longer be cancelled.", "not_cancellable")
        sl.status = ScheduledLoad.Status.CANCELLED
        sl.save(update_fields=["status"])
        return sl


def _fail_scheduled_load(sl: ScheduledLoad, reason: str):
    sl.status = ScheduledLoad.Status.FAILED
    sl.failure_reason = reason[:200]
    sl.executed_at = timezone.now()
    sl.save()
    _notify(
        sl.user,
        "Scheduled wallet load didn't go through",
        f"Your scheduled load of {sl.amount.normalize():f} GHS couldn't be started: {reason}",
        Notification.Category.TRANSACTION_UPDATE,
    )


def process_scheduled_load(scheduled_id):
    """
    Run one due scheduled wallet load. Safe to call concurrently / repeatedly.

    create_wallet_load talks to the payment provider, so — same reason the
    provider call in create_wallet_load itself happens outside a DB
    transaction — we don't hold the ScheduledLoad row locked while that
    network call is in flight. We claim the row first (short lock), then
    do the slow part, then record the outcome (another short lock).
    """
    with transaction.atomic():
        sl = (
            ScheduledLoad.objects.select_for_update(skip_locked=True, no_key=True, of=("self",))
            .select_related("user")
            .filter(pk=scheduled_id, status=ScheduledLoad.Status.SCHEDULED, run_at__lte=timezone.now())
            .first()
        )
        if not sl:
            return None

        if timezone.now() - sl.run_at > MAX_SCHEDULE_LATENESS:
            _fail_scheduled_load(sl, "it couldn't run at the scheduled time")
            return sl

        # Claim it now so a second sweep can never also pick it up.
        sl.status = ScheduledLoad.Status.COMPLETED
        sl.executed_at = timezone.now()
        sl.save(update_fields=["status", "executed_at"])

    try:
        txn, _ = create_wallet_load(
            user=sl.user,
            amount=sl.amount,
            network=sl.network,
            phone_number=sl.phone_number,
            idempotency_key=f"sched-{sl.pk}",
        )
    except PaymentError as exc:
        _fail_scheduled_load(sl, exc.message.rstrip("."))
        return sl

    sl.transaction = txn
    sl.save(update_fields=["transaction"])
    return sl


def run_due_scheduled_loads() -> int:
    ids = list(
        ScheduledLoad.objects.filter(status=ScheduledLoad.Status.SCHEDULED, run_at__lte=timezone.now())
        .order_by("run_at")
        .values_list("pk", flat=True)[:100]
    )
    for pk in ids:
        try:
            process_scheduled_load(pk)
        except Exception:
            logger.exception("Scheduled load %s crashed", pk)
    return len(ids)


# ---------------------------------------------------------------------------
# Scheduled withdrawals
# ---------------------------------------------------------------------------


def schedule_withdrawal(
    *,
    user,
    currency: str,
    amount,
    run_at,
    idempotency_key: str,
    destination_id=None,
    address: str = "",
    network: str = "",
    memo: str = "",
):
    ps = PaymentSettings.get()
    if not ps.withdrawals_enabled:
        raise PaymentError("Withdrawals are temporarily unavailable. Please try again later.", "paused")
    amount = _validate_amount(currency, amount)
    is_fiat = currency == FIAT_CURRENCY

    key = _namespaced_key(user, idempotency_key)
    with transaction.atomic():
        user = _lock_user(user)
        existing = ScheduledWithdrawal.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False

        _require_can_send(user, "schedule withdrawals")

        destination = None
        if is_fiat:
            destination = (
                PayoutDestination.objects.filter(pk=destination_id, user=user, is_active=True).first()
                if destination_id
                else None
            )
            if not destination:
                raise PaymentError("Choose where to send your money.")
            address, network, memo = "", "", ""
        else:
            if network not in CRYPTO_NETWORKS.get(currency, []):
                raise PaymentError(f"{currency} can't be withdrawn on that network.")
            address = (address or "").strip()
            if not is_valid_address(network, address):
                raise PaymentError(
                    "That doesn't look like a valid address for this network. Check it carefully — "
                    "crypto sent to a wrong address can't be recovered."
                )
            memo = (memo or "").strip()
            if memo and network not in MEMO_NETWORKS:
                raise PaymentError("This network doesn't use a memo or tag.")
            if memo and not memo.isdigit():
                raise PaymentError("The destination tag must be a number.")

        now = timezone.now()
        if run_at < now + MIN_SCHEDULE_LEAD:
            raise PaymentError("Choose a time at least a minute in the future.")
        if run_at > now + MAX_SCHEDULE_HORIZON:
            raise PaymentError("You can schedule up to a year ahead.")

        # A single withdrawal bigger than the whole daily limit could never run.
        ghs = _ghs_value(currency, amount)
        if ghs > Decimal(user.daily_limit()):
            raise PaymentError(
                f"That's above your {user.daily_limit():,} GHS daily limit, so it couldn't be sent. "
                "Verify your account to raise the limit.",
                "limit_exceeded",
            )

        active = ScheduledWithdrawal.objects.filter(
            user=user, status=ScheduledWithdrawal.Status.SCHEDULED
        ).count()
        if active >= MAX_ACTIVE_SCHEDULED:
            raise PaymentError(f"You can have up to {MAX_ACTIVE_SCHEDULED} scheduled withdrawals at a time.")

        obj = ScheduledWithdrawal.objects.create(
            user=user,
            currency=currency,
            amount=amount,
            destination=destination,
            address=address,
            network=network,
            memo=memo,
            run_at=run_at,
            idempotency_key=key,
        )
        _audit(user, "withdrawal_scheduled", "ScheduledWithdrawal", obj.pk, currency=currency, amount=amount)
        return obj, True


def cancel_scheduled_withdrawal(*, user, scheduled_id) -> ScheduledWithdrawal:
    with transaction.atomic():
        sw = (
            ScheduledWithdrawal.objects.select_for_update(no_key=True)
            .filter(pk=scheduled_id, user=user)
            .first()
        )
        if not sw:
            raise PaymentError("That scheduled withdrawal wasn't found.", "not_found")
        if sw.status != ScheduledWithdrawal.Status.SCHEDULED:
            raise PaymentError("This withdrawal can no longer be cancelled.", "not_cancellable")
        sw.status = ScheduledWithdrawal.Status.CANCELLED
        sw.save(update_fields=["status"])
        return sw


def _fail_scheduled_withdrawal(sw: ScheduledWithdrawal, reason: str):
    sw.status = ScheduledWithdrawal.Status.FAILED
    sw.failure_reason = reason[:200]
    sw.executed_at = timezone.now()
    sw.save()
    _notify(
        sw.user,
        "Scheduled withdrawal didn't go through",
        f"Your scheduled withdrawal of {sw.amount.normalize():f} {sw.currency} couldn't be sent: {reason}",
        Notification.Category.TRANSACTION_UPDATE,
    )


def process_scheduled_withdrawal(scheduled_id):
    """Run one due scheduled withdrawal. Safe to call concurrently / repeatedly."""
    with transaction.atomic():
        sw = (
            ScheduledWithdrawal.objects.select_for_update(skip_locked=True, no_key=True, of=("self",))
            .select_related("user", "destination")
            .filter(
                pk=scheduled_id,
                status=ScheduledWithdrawal.Status.SCHEDULED,
                run_at__lte=timezone.now(),
            )
            .first()
        )
        if not sw:
            return None

        if timezone.now() - sw.run_at > MAX_SCHEDULE_LATENESS:
            _fail_scheduled_withdrawal(sw, "it couldn't run at the scheduled time")
            return sw

        try:
            with transaction.atomic():  # savepoint: a failed attempt leaves no partial writes
                txn, _ = request_withdrawal(
                    user=sw.user,
                    currency=sw.currency,
                    amount=sw.amount,
                    idempotency_key=f"sched-{sw.pk}",
                    destination_id=sw.destination_id,
                    address=sw.address,
                    network=sw.network,
                    memo=sw.memo,
                    source="scheduled",
                )
        except PaymentError as exc:
            _fail_scheduled_withdrawal(sw, exc.message.rstrip("."))
            return sw

        sw.status = ScheduledWithdrawal.Status.COMPLETED
        sw.transaction = txn
        sw.executed_at = timezone.now()
        sw.save()
        return sw


def run_due_scheduled_withdrawals() -> int:
    ids = list(
        ScheduledWithdrawal.objects.filter(
            status=ScheduledWithdrawal.Status.SCHEDULED, run_at__lte=timezone.now()
        )
        .order_by("run_at")
        .values_list("pk", flat=True)[:100]
    )
    for pk in ids:
        try:
            process_scheduled_withdrawal(pk)
        except Exception:
            logger.exception("Scheduled withdrawal %s crashed", pk)
    return len(ids)
