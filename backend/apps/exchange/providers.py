"""
Exchange provider abstraction.

Everything in this file is what gets REPLACED once Breet (or another
liquidity partner) is actually integrated. Nothing outside this file
should need to change — TradeView calls `get_provider()` and only
knows about the ExchangeProvider interface, not which implementation
is behind it.

StubExchangeProvider exists purely so the rest of the app — the
trading UI, wallet updates, notifications, KYC limit checks — can be
built and genuinely tested TODAY, without waiting on Breet's API
access. It is explicitly NOT how a real provider will behave: real
trades will very likely settle ASYNCHRONOUSLY via a webhook (the
transaction sits at 'under_review' until Breet confirms it), not
instantly. The TradeView is deliberately written to create the
transaction as pending/under_review FIRST and then transition it to
settled as a SEPARATE step — that shape is what lets a real provider
slot in later: replace the instant `execute_trade()` call with an
API request, and let a webhook handler (not yet built) perform the
same "transition to settled" step whenever Breet confirms instead of
doing it synchronously.
"""

import uuid
from abc import ABC, abstractmethod
from decimal import Decimal


class ExchangeProvider(ABC):
    @abstractmethod
    def get_rates(self) -> dict:
        """Returns {currency: {"buy": Decimal, "sell": Decimal}}."""

    @abstractmethod
    def execute_trade(
        self, *, currency: str, direction: str, crypto_amount: Decimal, ghs_amount: Decimal
    ) -> dict:
        """
        Returns at least {"status": "settled" | "pending" | "failed",
        "external_reference": str}.
        """


class StubExchangeProvider(ExchangeProvider):
    def get_rates(self) -> dict:
        from .models import ExchangeRate

        return {
            rate.currency: {"buy": rate.buy_rate, "sell": rate.sell_rate}
            for rate in ExchangeRate.objects.all()
        }

    def execute_trade(self, *, currency, direction, crypto_amount, ghs_amount) -> dict:
        # Instant fill — a real provider will NOT behave this way.
        # See module docstring.
        return {"status": "settled", "external_reference": f"stub-{uuid.uuid4().hex[:12]}"}


def get_provider() -> ExchangeProvider:
    # Single swap point: once Breet's API is available, point this at
    # a new BreetExchangeProvider(ExchangeProvider) implementation.
    return StubExchangeProvider()
