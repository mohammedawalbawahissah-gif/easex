"""Helpers shared by the test suites (not imported by production code)."""

import itertools
from decimal import Decimal

from django.db import transaction

from apps.transactions import ledger
from apps.users.models import User
from apps.wallets.models import Wallet

_counter = itertools.count(1)
PASSWORD = "correct-horse-battery-1"
PIN = "482913"  # not sequential, not repeated — passes the weak-PIN rules


def make_user(name=None, tier="full", staff=False, flagged=False, pin=PIN):
    n = next(_counter)
    name = name or f"user{n}"
    user = User.objects.create_user(
        username=name,
        email=f"{name}@example.com",
        phone_number=f"+23324{n:07d}",
        password=PASSWORD,
    )
    user.kyc_tier = tier
    user.is_staff = staff
    user.is_flagged = flagged
    user.save()
    if pin:
        set_test_pin(user, pin)
    return user


def set_test_pin(user, pin=PIN):
    """Give a user a transaction PIN directly (bypassing the password + cooling-off flow of set_pin)."""
    from django.contrib.auth.hashers import make_password

    from apps.security import services as security

    profile = security.get_profile(user)
    profile.pin_hash = make_password(security._pin_digest(user, pin))
    profile.save()


def enable_2fa(user):
    """Turn 2FA on for a user; returns the base32 secret so tests can generate real codes."""
    import pyotp
    from django.utils import timezone

    from apps.security import crypto, services as security

    secret = pyotp.random_base32()
    profile = security.get_profile(user)
    profile.totp_secret_encrypted = crypto.encrypt(secret)
    profile.totp_confirmed_at = timezone.now()
    profile.save()
    return secret


def totp_code(secret, offset_steps=0):
    """A valid current authenticator code (optionally a neighbouring 30-second step)."""
    import time

    import pyotp

    return pyotp.TOTP(secret).at((int(time.time() // 30) + offset_steps) * 30)


def fund(user, currency, amount):
    """Put spendable balance in a wallet (through the ledger, like real code would)."""
    wallet, _ = Wallet.objects.get_or_create(user=user, currency=currency)
    with transaction.atomic():
        ledger.credit(wallet.pk, Decimal(str(amount)))
    wallet.refresh_from_db()
    return wallet


def wallet_of(user, currency) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(user=user, currency=currency)
    wallet.refresh_from_db()
    return wallet


def total_money(currency):
    """Balance + escrow across every wallet — must never change except by real deposits/withdrawals."""
    from django.db.models import F, Sum

    return Wallet.objects.filter(currency=currency).aggregate(t=Sum(F("balance") + F("escrow_balance")))["t"] or Decimal("0")
