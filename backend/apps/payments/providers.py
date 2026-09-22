"""
Payment provider abstraction — the ONE place that talks to the outside
world about moving money.

Same idea as exchange/providers.py: everything outside this file only
knows the PaymentProvider interface. When a real gateway is connected
(Paystack / Flutterwave / Hubtel for mobile money, Breet for on-chain
crypto), write a class here and point get_provider() at it. Nothing else
changes.

Two providers exist today:

ManualPaymentProvider  (default — safe in production)
    Makes no external calls. A wallet load waits for an admin to confirm the
    money arrived; a payout waits for an admin to send it by hand and press
    "settle". This is how EaseX can genuinely operate before any gateway is
    integrated. There is no way to receive crypto to a personal address, so
    on-chain deposits are unavailable until Breet (or similar) is connected.

StubPaymentProvider  (DEBUG only)
    Pretends everything succeeds instantly so the app can be developed and
    demoed end-to-end. It can create money from nothing, so it refuses to
    run unless DEBUG is on (and settings.py refuses to boot in production
    with it selected).

Result semantics — every send/collect call returns a ProviderResult:
    "settled"  the provider confirms the money moved
    "pending"  accepted, outcome not known yet (finalised later by an admin,
               a webhook or a poller — see services.finalize_*)
    "failed"   definitively did NOT happen (funds are returned to the user)
An *exception* means "we don't know" (timeout, 5xx) and is deliberately NOT
treated as failure — the caller must not retry blindly or it could pay twice.
"""

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


@dataclass
class ProviderResult:
    status: str  # "settled" | "pending" | "failed"
    reference: str = ""
    message: str = ""
    # True when "pending" means "a human at EaseX must act" (the manual
    # provider) rather than "waiting on the gateway / the user's phone".
    needs_admin: bool = False


@dataclass
class DepositInfo:
    address: str
    memo: str = ""


class ProviderUnavailable(Exception):
    """This provider can't do the requested thing (yet)."""


class PaymentProvider(ABC):
    name = "base"

    @abstractmethod
    def start_collection(self, *, reference: str, amount: Decimal, network: str, phone_number: str) -> ProviderResult:
        """Ask the user's mobile money account to pay `amount` GHS."""

    @abstractmethod
    def send_fiat_payout(self, *, reference: str, amount: Decimal, destination: dict) -> ProviderResult:
        """Pay `amount` GHS out to a mobile money destination."""

    @abstractmethod
    def send_crypto(
        self, *, reference: str, currency: str, network: str, amount: Decimal, address: str, memo: str
    ) -> ProviderResult:
        """Broadcast an on-chain withdrawal."""

    @abstractmethod
    def get_deposit_info(self, *, user_id: str, currency: str, network: str) -> DepositInfo:
        """A deposit address dedicated to this user. Raises ProviderUnavailable."""


class ManualPaymentProvider(PaymentProvider):
    name = "manual"

    def start_collection(self, *, reference, amount, network, phone_number):
        return ProviderResult("pending", reference=reference, message="Awaiting manual confirmation", needs_admin=True)

    def send_fiat_payout(self, *, reference, amount, destination):
        return ProviderResult("pending", reference="", message="Awaiting manual payout", needs_admin=True)

    def send_crypto(self, *, reference, currency, network, amount, address, memo):
        return ProviderResult("pending", reference="", message="Awaiting manual payout", needs_admin=True)

    def get_deposit_info(self, *, user_id, currency, network):
        raise ProviderUnavailable("Crypto deposits aren't available yet.")


class StubPaymentProvider(PaymentProvider):
    name = "stub"

    def start_collection(self, *, reference, amount, network, phone_number):
        return ProviderResult("settled", reference=f"stub-{uuid.uuid4().hex[:12]}")

    def send_fiat_payout(self, *, reference, amount, destination):
        return ProviderResult("settled", reference=f"stub-{uuid.uuid4().hex[:12]}")

    def send_crypto(self, *, reference, currency, network, amount, address, memo):
        return ProviderResult("settled", reference=f"stub-{uuid.uuid4().hex[:12]}")

    def get_deposit_info(self, *, user_id, currency, network):
        # Deliberately NOT a valid address on any chain, so nobody can
        # mistake it for a real one and send real funds to it.
        return DepositInfo(address=f"TESTONLY-{currency}-{network}-{str(user_id)[:8]}")


def get_provider() -> PaymentProvider:
    name = getattr(settings, "PAYMENTS_PROVIDER", "manual")
    if name == "stub":
        if not settings.DEBUG:
            raise ImproperlyConfigured(
                "PAYMENTS_PROVIDER=stub can create money from nothing and is only allowed with DEBUG=True."
            )
        return StubPaymentProvider()
    if name == "manual":
        return ManualPaymentProvider()
    raise ImproperlyConfigured(f"Unknown PAYMENTS_PROVIDER '{name}'.")
