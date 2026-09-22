from django.db import models


class TradableCurrency(models.TextChoices):
    """Mirrors Wallet.Currency minus GHS — only these are tradable."""
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


class ExchangeRate(models.Model):
    """
    Admin-editable placeholder for live market rates until Breet (or
    another liquidity provider) is actually integrated. buy_rate is
    what a user pays in GHS per 1 unit of crypto; sell_rate is what
    they receive in GHS per 1 unit sold. Real integration will likely
    replace reads of this table with a live API call — see
    StubExchangeProvider in providers.py for exactly where that swap
    happens.
    """

    currency = models.CharField(
        max_length=10, choices=TradableCurrency.choices, unique=True
    )
    buy_rate = models.DecimalField(max_digits=20, decimal_places=2)
    sell_rate = models.DecimalField(max_digits=20, decimal_places=2)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.currency}: buy {self.buy_rate} / sell {self.sell_rate} GHS"


class ExchangeRateHistory(models.Model):
    """
    Append-only snapshot log. A row is written automatically (see
    signals.py) every time an ExchangeRate is saved, so this table
    is what powers the rate-fluctuation chart on Trade — ExchangeRate
    itself only ever holds the current value.
    """

    currency = models.CharField(max_length=10, choices=TradableCurrency.choices)
    buy_rate = models.DecimalField(max_digits=20, decimal_places=2)
    sell_rate = models.DecimalField(max_digits=20, decimal_places=2)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["currency", "recorded_at"])]
        ordering = ["recorded_at"]

    def __str__(self):
        return f"{self.currency} @ {self.recorded_at}: buy {self.buy_rate} / sell {self.sell_rate}"
