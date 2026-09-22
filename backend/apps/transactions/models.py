import uuid
from django.conf import settings
from django.db import models

from apps.wallets.models import Wallet


class Transaction(models.Model):
    """
    The single source of truth for every value movement in EaseX.
    Every crypto trade, gift card sale, and payout is a row here.
    Wallet balances are recalculated FROM this table — never the
    other way around. This is the model to get right before
    anything else, since bugs here mean money bugs.
    """

    class TransactionType(models.TextChoices):
        CRYPTO_DEPOSIT = "crypto_deposit", "Crypto Deposit"
        CRYPTO_TRADE = "crypto_trade", "Crypto Trade"
        GIFTCARD_SALE = "giftcard_sale", "Gift Card Sale"
        FIAT_PAYOUT = "fiat_payout", "Fiat Payout"
        # --- Money movement added with the payments app ---
        # GHS added to a wallet (mobile money). Crypto arriving on-chain
        # keeps using CRYPTO_DEPOSIT; a GHS withdrawal keeps using
        # FIAT_PAYOUT — only the genuinely new kinds are added here.
        WALLET_LOAD = "wallet_load", "Wallet Load"
        CRYPTO_WITHDRAWAL = "crypto_withdrawal", "Crypto Withdrawal"
        # A user-to-user transfer is TWO linked rows (one per user) so
        # each side sees it in their own history. See payments/services.py.
        TRANSFER_OUT = "transfer_out", "Transfer Sent"
        TRANSFER_IN = "transfer_in", "Transfer Received"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        UNDER_REVIEW = "under_review", "Under Review"
        VERIFIED = "verified", "Verified"
        SETTLED = "settled", "Settled"
        REJECTED = "rejected", "Rejected"
        FLAGGED = "flagged", "Flagged for Compliance"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="transactions",
    )
    wallet = models.ForeignKey(
        Wallet, on_delete=models.PROTECT, related_name="transactions",
        help_text="The wallet that RECEIVES value from this transaction",
    )
    counter_wallet = models.ForeignKey(
        Wallet,
        on_delete=models.PROTECT,
        related_name="counter_transactions",
        null=True,
        blank=True,
        help_text=(
            "Only set for two-sided moves like a crypto trade — the "
            "wallet value is PAID FROM. The paid amount lives in "
            "metadata['counter_amount']. Null for one-sided "
            "transactions (gift card sale, payout, deposit)."
        ),
    )
    transaction_type = models.CharField(max_length=20, choices=TransactionType.choices)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    currency = models.CharField(max_length=10)

    idempotency_key = models.CharField(max_length=100, unique=True)

    ghs_value = models.DecimalField(
        max_digits=20,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "GHS-equivalent of `amount` at the moment the transaction was "
            "created. Set for money leaving/entering the platform so KYC "
            "limits can be summed in the database instead of re-pricing "
            "history."
        ),
    )

    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verified_transactions",
        help_text="Staff user who manually verified this, if applicable",
    )

    external_reference = models.CharField(
        max_length=200,
        blank=True,
        help_text="e.g. Breet transaction ID, on-chain tx hash",
    )
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["transaction_type", "status"]),
            models.Index(fields=["user", "transaction_type", "created_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0), name="transaction_amount_positive"
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} — {self.amount} {self.currency} ({self.status})"
