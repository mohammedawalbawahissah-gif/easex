import uuid
from django.conf import settings
from django.db import models


class Wallet(models.Model):
    """
    One wallet per user per currency. Balances here are always
    derived/cached from the Transaction ledger — never edited
    directly. Treat this as a read-optimized view, not the
    source of truth.
    """

    class Currency(models.TextChoices):
        GHS = "GHS", "Ghanaian Cedi"
        BTC = "BTC", "Bitcoin"
        ETH = "ETH", "Ethereum"
        USDT = "USDT", "Tether"
        USDC = "USDC", "USD Coin"
        BNB = "BNB", "BNB"
        SOL = "SOL", "Solana"
        XRP = "XRP", "XRP"
        ADA = "ADA", "Cardano"
        DOGE = "DOGE", "Dogecoin"
        LTC = "LTC", "Litecoin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wallets"
    )
    currency = models.CharField(max_length=10, choices=Currency.choices)
    balance = models.DecimalField(max_digits=20, decimal_places=8, default=0)
    escrow_balance = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default=0,
        help_text="Funds held pending verification, not yet spendable",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "currency")
        constraints = [
            # Last line of defence: even if application code has a bug,
            # the database refuses to let a wallet go negative.
            models.CheckConstraint(
                condition=models.Q(balance__gte=0), name="wallet_balance_non_negative"
            ),
            models.CheckConstraint(
                condition=models.Q(escrow_balance__gte=0), name="wallet_escrow_non_negative"
            ),
        ]

    def __str__(self):
        return f"{self.user} — {self.currency}: {self.balance}"
