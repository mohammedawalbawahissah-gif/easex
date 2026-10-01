"""
Payment provider abstraction — the ONE place that talks to the outside
world about moving money.

Same idea as exchange/providers.py: everything outside this file only
knows the PaymentProvider interface. Nothing in views.py, services.py or
tasks.py needs to change when a new rail is added here.

Providers today:

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

HubtelProvider  (mtn / telecel / airteltigo mobile money, via Hubtel)
    Hubtel is a single aggregator for all three GH mobile money networks,
    so one integration covers MTN MoMo, Telecel Cash and AirtelTigo Money.
    Off by default — see settings.HUBTEL_ENABLED.

MTNMoMoProvider  (MTN MoMo, direct via MTN's own Open API)
    An alternative to routing MTN traffic through Hubtel: lower fees at the
    cost of a second integration to maintain. Only ever used for the "mtn"
    network, and only when settings.MTN_MOMO_DIRECT_ENABLED is on — Hubtel
    still carries telecel/airteltigo either way.

BankTransferProvider  (direct bank transfer)
    Ghana doesn't have one universal "pay into any bank" API the way it has
    aggregators for mobile money, so — like ManualPaymentProvider — this
    shows the user EaseX's account details and a reference, and a human
    reconciles it against the bank statement. It's its own class (not just
    reuse of ManualPaymentProvider) so it can later be swapped for a real
    virtual-account/bank-checkout product without touching call sites.

get_provider_for(network=...) is what services.py actually calls for a
mobile-money-or-bank rail: it routes "mtn"/"telecel"/"airteltigo" to Hubtel,
"mtn" specifically to MTNMoMoProvider if that flag is on, "bank" to
BankTransferProvider, and falls back to get_provider() (manual/stub) for
anything not yet switched on. Crypto still goes through get_provider()
directly, unchanged.

Result semantics — every send/collect call returns a ProviderResult:
    "settled"  the provider confirms the money moved
    "pending"  accepted, outcome not known yet (finalised later by an admin,
               a webhook or a poller — see services.finalize_*)
    "failed"   definitively did NOT happen (funds are returned to the user)
An *exception* means "we don't know" (timeout, 5xx) and is deliberately NOT
treated as failure — the caller must not retry blindly or it could pay twice.
"""

import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = 15  # seconds — deliberately short; a timeout means "unknown", not "failed"


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


# --- Hubtel: mtn / telecel / airteltigo mobile money ------------------------

# Hubtel's channel codes for its Receive/Send Money APIs. Verify these
# against Hubtel's current docs before going live — aggregators occasionally
# rename channels (e.g. around the Vodafone GH -> Telecel rebrand), and
# that's exactly the kind of thing that's cheap to get wrong here and
# expensive to get wrong in production.
HUBTEL_CHANNELS = {
    "mtn": "mtn-gh",
    "telecel": "vodafone-gh",
    "airteltigo": "tigo-gh",
}


class HubtelProvider(PaymentProvider):
    """
    Mobile money via Hubtel's Receive Money (collections) and Send Money
    (payouts) APIs — one integration covering MTN MoMo, Telecel Cash and
    AirtelTigo Money.

    Docs: https://developers.hubtel.com/ (Receive Money Prepaid / Send Money)
    Auth: HTTP Basic, using the Client ID/Secret from the Hubtel dashboard —
    NOT the same as your Hubtel login.
    """

    name = "hubtel"

    def __init__(self):
        self.client_id = settings.HUBTEL_CLIENT_ID
        self.client_secret = settings.HUBTEL_CLIENT_SECRET
        self.pos_sales_id = settings.HUBTEL_POS_SALES_ID  # a.k.a. merchant account number
        self.callback_url = settings.HUBTEL_CALLBACK_URL
        if not (self.client_id and self.client_secret and self.pos_sales_id):
            raise ImproperlyConfigured(
                "HUBTEL_ENABLED is True but HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET / "
                "HUBTEL_POS_SALES_ID aren't all set."
            )

    def _auth(self):
        return (self.client_id, self.client_secret)

    def start_collection(self, *, reference, amount, network, phone_number):
        channel = HUBTEL_CHANNELS.get(network)
        if channel is None:
            raise ProviderUnavailable(f"Hubtel doesn't carry the '{network}' network.")
        url = f"https://rmp.hubtel.com/merchantaccount/merchants/{self.pos_sales_id}/receive/mobilemoney"
        payload = {
            "CustomerName": "EaseX user",
            "CustomerMsisdn": phone_number,
            "Channel": channel,
            "Amount": str(amount),
            "PrimaryCallbackUrl": self.callback_url,
            "Description": "EaseX wallet load",
            "ClientReference": reference,
        }
        try:
            resp = requests.post(url, json=payload, auth=self._auth(), timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException:
            logger.exception("Hubtel start_collection request failed for %s", reference)
            raise  # unknown outcome — caller treats this as "pending, needs review", never as failure
        # Hubtel's Receive Money flow is async either way: even a "0001"
        # (accepted) response just means the prompt was sent to the phone.
        # The actual outcome always comes back on PrimaryCallbackUrl.
        status = str(data.get("ResponseCode", ""))
        if status not in ("0000", "0001"):
            return ProviderResult("failed", message=data.get("Message", "Hubtel declined the request."))
        return ProviderResult("pending", reference=data.get("Data", {}).get("TransactionId", reference))

    def send_fiat_payout(self, *, reference, amount, destination):
        channel = HUBTEL_CHANNELS.get(destination.get("network", ""))
        if channel is None:
            raise ProviderUnavailable(f"Hubtel doesn't carry the '{destination.get('network')}' network.")
        url = f"https://smp.hubtel.com/api/{self.pos_sales_id}/send/mobilemoney"
        payload = {
            "RecipientName": destination.get("account_name", ""),
            "RecipientMsisdn": destination.get("account_number", ""),
            "Channel": channel,
            "Amount": str(amount),
            "Description": "EaseX withdrawal",
            "ClientReference": reference,
        }
        try:
            resp = requests.post(url, json=payload, auth=self._auth(), timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException:
            logger.exception("Hubtel send_fiat_payout request failed for %s", reference)
            raise
        status = str(data.get("ResponseCode", ""))
        if status not in ("0000", "0001"):
            return ProviderResult("failed", message=data.get("Message", "Hubtel declined the payout."))
        return ProviderResult("pending", reference=data.get("Data", {}).get("TransactionId", reference))

    def send_crypto(self, *, reference, currency, network, amount, address, memo):
        raise ProviderUnavailable("Hubtel doesn't move crypto. Configure Breet for crypto withdrawals.")

    def get_deposit_info(self, *, user_id, currency, network):
        raise ProviderUnavailable("Hubtel doesn't issue crypto deposit addresses.")


# --- MTN MoMo: direct via MTN's Open API (optional, MTN-only) ---------------


class MTNMoMoProvider(PaymentProvider):
    """
    MTN Mobile Money via MTN's own Open API (Collections for deposits,
    Disbursements for payouts) instead of going through Hubtel. Cuts out
    the aggregator fee on MTN traffic specifically, at the cost of a
    second set of credentials/sandbox to manage. get_provider_for() only
    ever routes network == "mtn" here — telecel/airteltigo still go to
    Hubtel regardless of this flag.

    Docs: https://momodeveloper.mtn.com/
    Auth: OAuth2 bearer token, obtained per-request with the Ocp-Apim-
    Subscription-Key + Basic auth of the API user/key MTN issued you.
    """

    name = "mtn_momo"
    BASE_URL = "https://proxy.momoapi.mtn.com"  # sandbox: https://sandbox.momodeveloper.mtn.com

    def __init__(self):
        self.subscription_key = settings.MTN_MOMO_SUBSCRIPTION_KEY
        self.api_user = settings.MTN_MOMO_API_USER
        self.api_key = settings.MTN_MOMO_API_KEY
        self.target_env = settings.MTN_MOMO_TARGET_ENVIRONMENT
        self.callback_url = settings.MTN_MOMO_CALLBACK_URL
        if not (self.subscription_key and self.api_user and self.api_key):
            raise ImproperlyConfigured(
                "MTN_MOMO_DIRECT_ENABLED is True but MTN_MOMO_SUBSCRIPTION_KEY / "
                "MTN_MOMO_API_USER / MTN_MOMO_API_KEY aren't all set."
            )

    def _token(self, product: str) -> str:
        """product is 'collection' or 'disbursement' — MTN issues separate tokens per product."""
        url = f"{self.BASE_URL}/{product}/token/"
        resp = requests.post(
            url,
            auth=(self.api_user, self.api_key),
            headers={"Ocp-Apim-Subscription-Key": self.subscription_key},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

    def start_collection(self, *, reference, amount, network, phone_number):
        if network != "mtn":
            raise ProviderUnavailable("MTNMoMoProvider only handles the mtn network.")
        ref_id = str(uuid.uuid4())
        token = self._token("collection")
        url = f"{self.BASE_URL}/collection/v1_0/requesttopay"
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Reference-Id": ref_id,
            "X-Target-Environment": self.target_env,
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Content-Type": "application/json",
        }
        payload = {
            "amount": str(amount),
            "currency": "GHS",
            "externalId": reference,
            "payer": {"partyIdType": "MSISDN", "partyId": phone_number},
            "payerMessage": "EaseX wallet load",
            "payeeNote": "EaseX wallet load",
        }
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=HTTP_TIMEOUT)
        except requests.RequestException:
            logger.exception("MTN MoMo requesttopay failed for %s", reference)
            raise
        if resp.status_code != 202:
            return ProviderResult("failed", message=f"MTN MoMo rejected the request ({resp.status_code}).")
        # 202 only means "queued". MTN calls back to X-Callback-Url (set at
        # subscription level in the MoMo developer portal) or must be polled
        # with GET .../requesttopay/{ref_id} — poll via a Celery task if you
        # don't want to rely solely on the callback arriving.
        return ProviderResult("pending", reference=ref_id)

    def send_fiat_payout(self, *, reference, amount, destination):
        if destination.get("network") != "mtn":
            raise ProviderUnavailable("MTNMoMoProvider only handles the mtn network.")
        ref_id = str(uuid.uuid4())
        token = self._token("disbursement")
        url = f"{self.BASE_URL}/disbursement/v1_0/transfer"
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Reference-Id": ref_id,
            "X-Target-Environment": self.target_env,
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Content-Type": "application/json",
        }
        payload = {
            "amount": str(amount),
            "currency": "GHS",
            "externalId": reference,
            "payee": {"partyIdType": "MSISDN", "partyId": destination.get("account_number", "")},
            "payerMessage": "EaseX withdrawal",
            "payeeNote": "EaseX withdrawal",
        }
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=HTTP_TIMEOUT)
        except requests.RequestException:
            logger.exception("MTN MoMo transfer failed for %s", reference)
            raise
        if resp.status_code != 202:
            return ProviderResult("failed", message=f"MTN MoMo rejected the payout ({resp.status_code}).")
        return ProviderResult("pending", reference=ref_id)

    def send_crypto(self, *, reference, currency, network, amount, address, memo):
        raise ProviderUnavailable("MTN MoMo doesn't move crypto. Configure Breet for crypto withdrawals.")

    def get_deposit_info(self, *, user_id, currency, network):
        raise ProviderUnavailable("MTN MoMo doesn't issue crypto deposit addresses.")


# --- Bank transfer (semi-manual — see class docstring) -----------------------


class BankTransferProvider(PaymentProvider):
    """
    Direct bank transfer. There's no single "pay any Ghanaian bank account"
    API the way Hubtel/MTN cover mobile money, so — same honest approach as
    ManualPaymentProvider — a load shows the user EaseX's account details
    plus their reference and waits for a human to match the bank statement;
    a payout waits for a human to initiate the transfer and mark it sent.

    If you later contract a specific aggregator for automated bank rails
    (e.g. a Hubtel bank/card checkout, or a bank's own virtual-account
    product), replace the bodies below with real API calls — the shape of
    this class (and everything that calls it) doesn't need to change.
    """

    name = "bank_transfer"

    def start_collection(self, *, reference, amount, network, phone_number):
        return ProviderResult(
            "pending",
            reference=reference,
            message="Awaiting bank transfer confirmation",
            needs_admin=True,
        )

    def send_fiat_payout(self, *, reference, amount, destination):
        return ProviderResult(
            "pending",
            reference="",
            message="Awaiting manual bank payout",
            needs_admin=True,
        )

    def send_crypto(self, *, reference, currency, network, amount, address, memo):
        raise ProviderUnavailable("Bank transfer doesn't move crypto.")

    def get_deposit_info(self, *, user_id, currency, network):
        raise ProviderUnavailable("Bank transfer doesn't issue crypto deposit addresses.")


# --- Routing: which rail handles which network? ------------------------------


def get_provider_for(*, network: str = "") -> PaymentProvider:
    """
    The router services.py actually calls for a fiat collection or payout.

    Each rail has its own on/off switch (HUBTEL_ENABLED, MTN_MOMO_DIRECT_
    ENABLED, BANK_PROVIDER) defaulting to off/manual, so turning this
    function on doesn't change behaviour anywhere until someone explicitly
    flips a flag in settings — same safe-by-default posture as
    PAYMENTS_PROVIDER itself. Crypto is unaffected: it still goes through
    get_provider() directly.
    """
    if network == "bank":
        if getattr(settings, "BANK_PROVIDER", "manual") == "bank_transfer":
            return BankTransferProvider()
        return get_provider()
    if network == "mtn" and getattr(settings, "MTN_MOMO_DIRECT_ENABLED", False):
        return MTNMoMoProvider()
    if network in HUBTEL_CHANNELS and getattr(settings, "HUBTEL_ENABLED", False):
        return HubtelProvider()
    return get_provider()
