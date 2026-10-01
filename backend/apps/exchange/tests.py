from decimal import Decimal

from rest_framework.test import APIClient, APITestCase

from apps.payments.testing import fund, make_user
from apps.transactions.models import Transaction
from apps.wallets.models import Wallet

from .models import ExchangeRate, TradableCurrency


class TradeIdempotencyTests(APITestCase):
    """
    TradeView — found during the Sept 24 audit with NO duplicate-submission
    protection at all: unlike every other money-movement endpoint
    (apps.payments), the trade endpoint generated a fresh random
    idempotency_key server-side on every call instead of accepting a
    client-supplied one, so a network retry or a double-tap silently
    executed the same trade twice. Confirmed live against a real request
    before fixing: identical back-to-back trade requests produced two
    separate settled transactions and debited the wallet twice.
    """

    def setUp(self):
        self.user = make_user("trader", tier="full")
        fund(self.user, Wallet.Currency.GHS, Decimal("1000000.00"))
        ExchangeRate.objects.update_or_create(
            currency=TradableCurrency.BTC,
            defaults={"buy_rate": Decimal("500000.00"), "sell_rate": Decimal("490000.00")},
        )
        self.client_ = APIClient()
        self.client_.force_authenticate(self.user)

    def _payload(self, key):
        return {"currency": "BTC", "direction": "buy", "amount": "0.001", "idempotency_key": key}

    def test_a_retried_request_with_the_same_key_is_not_duplicated(self):
        r1 = self.client_.post("/api/exchange/trade/", self._payload("same-key-001"), format="json")
        r2 = self.client_.post("/api/exchange/trade/", self._payload("same-key-001"), format="json")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 200)  # same transaction returned, not a new one
        self.assertEqual(r1.json()["id"], r2.json()["id"])
        self.assertEqual(
            Transaction.objects.filter(user=self.user, transaction_type="crypto_trade").count(), 1
        )

    def test_a_genuinely_different_key_creates_a_separate_trade(self):
        r1 = self.client_.post("/api/exchange/trade/", self._payload("key-a-001"), format="json")
        r2 = self.client_.post("/api/exchange/trade/", self._payload("key-b-002"), format="json")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertNotEqual(r1.json()["id"], r2.json()["id"])
        self.assertEqual(
            Transaction.objects.filter(user=self.user, transaction_type="crypto_trade").count(), 2
        )

    def test_the_same_key_from_a_different_user_does_not_collide(self):
        """Namespacing check — two different users using the same literal key must not see each other's trade."""
        other = make_user("other_trader", tier="full")
        fund(other, Wallet.Currency.GHS, Decimal("1000000.00"))
        other_client = APIClient()
        other_client.force_authenticate(other)

        r1 = self.client_.post("/api/exchange/trade/", self._payload("shared-literal-key"), format="json")
        r2 = other_client.post("/api/exchange/trade/", self._payload("shared-literal-key"), format="json")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)  # NOT 200 — this must be treated as a distinct trade
        self.assertNotEqual(r1.json()["id"], r2.json()["id"])

    def test_missing_idempotency_key_is_rejected(self):
        r = self.client_.post(
            "/api/exchange/trade/",
            {"currency": "BTC", "direction": "buy", "amount": "0.001"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
