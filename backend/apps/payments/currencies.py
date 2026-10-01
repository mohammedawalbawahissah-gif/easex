"""
Per-asset facts the payments code needs: which networks an asset can be
sent on, what an address on that network looks like, and how many
decimal places are allowed.

Address checks here are FORMAT checks — they catch typos and
wrong-network pastes (an 0x address for a Bitcoin withdrawal). They do
not prove the address exists or that its checksum is valid; that is the
liquidity provider's job when a real one is connected.
"""

import re
from decimal import Decimal

from apps.wallets.models import Wallet

FIAT_CURRENCY = Wallet.Currency.GHS.value
CRYPTO_CURRENCIES = [c for c, _ in Wallet.Currency.choices if c != FIAT_CURRENCY]

# Sending on the wrong network loses the funds, so the network is always
# an explicit choice — never inferred from the asset alone.
CRYPTO_NETWORKS = {
    "BTC": ["bitcoin"],
    "ETH": ["ethereum"],
    "USDT": ["trc20", "erc20", "bep20"],
    "USDC": ["erc20", "bep20", "solana"],
    "BNB": ["bep20"],
    "SOL": ["solana"],
    "XRP": ["xrp"],
    "ADA": ["cardano"],
    "DOGE": ["dogecoin"],
    "LTC": ["litecoin"],
}

NETWORK_LABELS = {
    "bitcoin": "Bitcoin",
    "ethereum": "Ethereum (ERC-20)",
    "erc20": "Ethereum (ERC-20)",
    "bep20": "BNB Smart Chain (BEP-20)",
    "trc20": "Tron (TRC-20)",
    "solana": "Solana",
    "xrp": "XRP Ledger",
    "cardano": "Cardano",
    "dogecoin": "Dogecoin",
    "litecoin": "Litecoin",
}

_BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_B58 = "1-9A-HJ-NP-Za-km-z"

ADDRESS_PATTERNS = {
    "bitcoin": re.compile(rf"^(bc1[{_BECH32}]{{11,71}}|[13][a-km-zA-HJ-NP-Z1-9]{{25,34}})$"),
    "ethereum": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "erc20": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "bep20": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "trc20": re.compile(rf"^T[{_B58}]{{33}}$"),
    "solana": re.compile(rf"^[{_B58}]{{32,44}}$"),
    "xrp": re.compile(rf"^r[{_B58}]{{24,34}}$"),
    "cardano": re.compile(rf"^addr1[{_BECH32}]{{50,110}}$"),
    "dogecoin": re.compile(rf"^D[5-9A-HJ-NP-U][{_B58}]{{32}}$"),
    "litecoin": re.compile(rf"^(ltc1[{_BECH32}]{{11,71}}|[LM3][a-km-zA-HJ-NP-Z1-9]{{26,33}})$"),
}

# Networks where the destination needs an extra tag/memo.
MEMO_NETWORKS = {"xrp"}

MOBILE_MONEY_NETWORKS = {
    "mtn": "MTN Mobile Money",
    "telecel": "Telecel Cash",
    "airteltigo": "AirtelTigo Money",
}

# Every rail a user can pick to load their wallet: the three mobile money
# networks (routed to Hubtel or, for MTN specifically, direct MTN MoMo —
# see payments/providers.py get_provider_for) plus a direct bank transfer.
PAYMENT_METHODS = {
    **MOBILE_MONEY_NETWORKS,
    "bank": "Bank transfer",
}


def decimal_places(currency: str) -> int:
    return 2 if currency == FIAT_CURRENCY else 8


def has_valid_precision(amount: Decimal, currency: str) -> bool:
    # normalize() first: "200.00000000" (how DRF pads decimals) is just 200.
    exponent = amount.normalize().as_tuple().exponent
    return exponent >= -decimal_places(currency)


def is_valid_address(network: str, address: str) -> bool:
    pattern = ADDRESS_PATTERNS.get(network)
    return bool(pattern and pattern.match(address))


def normalize_gh_phone(raw: str) -> str | None:
    """Return a Ghana mobile number as 0XXXXXXXXX, or None if it isn't one."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("233") and len(digits) == 12:
        digits = "0" + digits[3:]
    if re.fullmatch(r"0[235]\d{8}", digits):
        return digits
    return None
