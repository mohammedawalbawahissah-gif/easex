"""
The ledger: the ONLY code that changes Wallet.balance / escrow_balance.

Why this exists
---------------
Balances used to be changed by `wallet.balance += x; wallet.save()` on
whatever wallet instance happened to be in memory. Two requests running
at once could each read the same balance and both write back — one
update silently lost (a double-spend, or a double-credit).

Everything here instead uses single-statement, database-side updates:

    UPDATE wallets SET balance = balance - 10
    WHERE id = ... AND balance >= 10

The row is locked for the duration of that statement, the check and the
write cannot be separated, and "0 rows updated" means "insufficient
funds" — no read-then-write window at all.

Callers MUST already be inside `transaction.atomic()`, so that a failure
part-way through (say, the debit succeeds but the matching credit
doesn't) rolls the whole thing back. That's enforced below.

Holds
-----
`escrow_balance` is used as a HOLD for money that has been requested to
leave but hasn't yet: a withdrawal moves funds balance -> escrow at
request time (so they can't be spent twice), then either
  * settles  -> escrow is released to the outside world  (capture)
  * is rejected -> escrow returns to balance             (release)
"""

from decimal import Decimal

from django.db import connection
from django.db.models import F
from django.utils import timezone

from apps.wallets.models import Wallet

from .models import Transaction

T = Transaction.TransactionType

# Money arriving in the user's wallet when the transaction settles.
CREDIT_TYPES = frozenset({T.CRYPTO_DEPOSIT, T.GIFTCARD_SALE, T.WALLET_LOAD, T.TRANSFER_IN})

# Money leaving a wallet via a plain (un-held) debit at settlement.
DEBIT_TYPES = frozenset({T.TRANSFER_OUT})

# Money leaving the platform. These reserve a hold at request time.
WITHDRAWAL_TYPES = frozenset({T.FIAT_PAYOUT, T.CRYPTO_WITHDRAWAL})

# Everything that reduces the user's spendable balance (drives limits
# and the client's balance-history chart).
OUTGOING_TYPES = DEBIT_TYPES | WITHDRAWAL_TYPES

TERMINAL_STATUSES = frozenset({Transaction.Status.SETTLED, Transaction.Status.REJECTED})

HOLD_KEY = "hold"
HOLD_HELD = "held"
HOLD_CAPTURED = "captured"
HOLD_RELEASED = "released"


class InsufficientFunds(Exception):
    """Raised when a guarded debit/hold would take a wallet below zero."""


class InvalidTransition(Exception):
    """Raised when a transaction is pushed out of a terminal state."""


class NotInAtomicBlock(RuntimeError):
    pass


def require_atomic():
    if not connection.in_atomic_block:
        raise NotInAtomicBlock(
            "Ledger operations must run inside transaction.atomic() so a "
            "partial failure rolls back cleanly."
        )


def _dec(amount) -> Decimal:
    value = Decimal(str(amount))
    if value <= 0:
        raise ValueError("Ledger amounts must be positive.")
    return value


def credit(wallet_id, amount):
    require_atomic()
    Wallet.objects.filter(pk=wallet_id).update(
        balance=F("balance") + _dec(amount), updated_at=timezone.now()
    )


def debit(wallet_id, amount):
    require_atomic()
    amount = _dec(amount)
    updated = Wallet.objects.filter(pk=wallet_id, balance__gte=amount).update(
        balance=F("balance") - amount, updated_at=timezone.now()
    )
    if not updated:
        raise InsufficientFunds("Insufficient balance.")


def hold(wallet_id, amount):
    """balance -> escrow. Raises InsufficientFunds if not enough spendable balance."""
    require_atomic()
    amount = _dec(amount)
    updated = Wallet.objects.filter(pk=wallet_id, balance__gte=amount).update(
        balance=F("balance") - amount,
        escrow_balance=F("escrow_balance") + amount,
        updated_at=timezone.now(),
    )
    if not updated:
        raise InsufficientFunds("Insufficient balance.")


def release(wallet_id, amount):
    """escrow -> balance (a held payout that will not happen)."""
    require_atomic()
    amount = _dec(amount)
    updated = Wallet.objects.filter(pk=wallet_id, escrow_balance__gte=amount).update(
        escrow_balance=F("escrow_balance") - amount,
        balance=F("balance") + amount,
        updated_at=timezone.now(),
    )
    if not updated:
        raise InsufficientFunds("Held funds are missing — refusing to release.")


def capture(wallet_id, amount):
    """escrow -> gone (a held payout that has actually been sent)."""
    require_atomic()
    amount = _dec(amount)
    updated = Wallet.objects.filter(pk=wallet_id, escrow_balance__gte=amount).update(
        escrow_balance=F("escrow_balance") - amount, updated_at=timezone.now()
    )
    if not updated:
        raise InsufficientFunds("Held funds are missing — refusing to capture.")


# ---------------------------------------------------------------------------
# Status-transition effects. Called from the pre_save signal in signals.py,
# which is the single place a Transaction's status change turns into money.
# ---------------------------------------------------------------------------


def apply_settlement(txn: Transaction):
    """Move the money for a transaction that has just become SETTLED."""
    txn_type = txn.transaction_type

    if txn_type in CREDIT_TYPES:
        credit(txn.wallet_id, txn.amount)

    elif txn_type in DEBIT_TYPES:
        debit(txn.wallet_id, txn.amount)

    elif txn_type in WITHDRAWAL_TYPES:
        if txn.metadata.get(HOLD_KEY) == HOLD_HELD:
            capture(txn.wallet_id, txn.amount)
            txn.metadata[HOLD_KEY] = HOLD_CAPTURED
        else:
            # Legacy / manually-created payout with no hold on it.
            debit(txn.wallet_id, txn.amount)

    elif txn_type == T.CRYPTO_TRADE:
        # Two-sided: pay out of the counter wallet first (the one that can
        # fail), then credit what was received.
        if txn.counter_wallet_id:
            counter_amount = Decimal(str(txn.metadata.get("counter_amount", "0")))
            if counter_amount > 0:
                debit(txn.counter_wallet_id, counter_amount)
        credit(txn.wallet_id, txn.amount)


def apply_rejection(txn: Transaction):
    """A held withdrawal that is rejected gives the money back."""
    if txn.transaction_type in WITHDRAWAL_TYPES and txn.metadata.get(HOLD_KEY) == HOLD_HELD:
        release(txn.wallet_id, txn.amount)
        txn.metadata[HOLD_KEY] = HOLD_RELEASED


def settle_transaction(txn_id, *, from_statuses):
    """
    Atomically lock a transaction and move it to SETTLED, crediting or
    debiting wallets via the signal. Returns the refreshed transaction.
    Raises InvalidTransition if it isn't in one of `from_statuses`.
    """
    from django.db import transaction as db_transaction

    with db_transaction.atomic():
        txn = Transaction.objects.select_for_update(no_key=True).get(pk=txn_id)
        if txn.status not in from_statuses:
            raise InvalidTransition(f"Cannot settle a transaction that is {txn.status}.")
        txn.status = Transaction.Status.SETTLED
        txn.save()
        return txn
