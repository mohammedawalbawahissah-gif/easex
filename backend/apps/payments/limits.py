"""
Pricing and KYC limit checks for money movement.

`User.daily_limit()` (existing) is the per-tier cap in GHS. Trades already
compared a single buy against it; for withdrawals, transfers and wallet
loads it is applied as a genuine ROLLING 24-HOUR TOTAL, which is what
"daily limit" means to users and to regulators.
"""

from datetime import timedelta
from decimal import ROUND_UP, Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.exchange.models import ExchangeRate
from apps.transactions.ledger import OUTGOING_TYPES
from apps.transactions.models import Transaction

from .currencies import FIAT_CURRENCY

CENT = Decimal("0.01")


class UnpriceableAsset(Exception):
    pass


def ghs_value(currency: str, amount: Decimal) -> Decimal:
    """
    GHS-equivalent of `amount`. Uses the HIGHER of buy/sell rate so a limit
    is never under-counted, and rounds up for the same reason.
    """
    if currency == FIAT_CURRENCY:
        return Decimal(amount).quantize(CENT, rounding=ROUND_UP)
    rate = ExchangeRate.objects.filter(currency=currency).first()
    if not rate:
        raise UnpriceableAsset(currency)
    price = max(rate.buy_rate, rate.sell_rate)
    return (Decimal(amount) * price).quantize(CENT, rounding=ROUND_UP)


def _used_24h(user, types) -> Decimal:
    since = timezone.now() - timedelta(hours=24)
    total = (
        Transaction.objects.filter(user=user, transaction_type__in=types, created_at__gte=since)
        .exclude(status=Transaction.Status.REJECTED)
        .aggregate(total=Sum("ghs_value"))["total"]
    )
    return total or Decimal("0")


def outgoing_used_24h(user) -> Decimal:
    return _used_24h(user, OUTGOING_TYPES)


def loads_used_24h(user) -> Decimal:
    return _used_24h(user, [Transaction.TransactionType.WALLET_LOAD])


def outgoing_remaining(user) -> Decimal:
    return max(Decimal(user.daily_limit()) - outgoing_used_24h(user), Decimal("0"))


def loads_remaining(user) -> Decimal:
    return max(Decimal(user.daily_limit()) - loads_used_24h(user), Decimal("0"))
