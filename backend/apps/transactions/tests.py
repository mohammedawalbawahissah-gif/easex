from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework.test import APITestCase

from apps.payments.testing import fund, make_user, wallet_of
from apps.transactions import ledger
from apps.transactions.models import Transaction
from apps.wallets.models import Wallet


class LedgerPrimitivesTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.wallet = fund(self.user, "GHS", 100)

    def test_debit_refuses_to_overdraw(self):
        with self.assertRaises(ledger.InsufficientFunds):
            with transaction.atomic():
                ledger.debit(self.wallet.pk, Decimal("100.01"))
        self.assertEqual(wallet_of(self.user, "GHS").balance, Decimal("100"))

    def test_hold_release_capture_conserve_money(self):
        with transaction.atomic():
            ledger.hold(self.wallet.pk, Decimal("40"))
        w = wallet_of(self.user, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("60"), Decimal("40")))
        with transaction.atomic():
            ledger.release(self.wallet.pk, Decimal("15"))
            ledger.capture(self.wallet.pk, Decimal("25"))
        w = wallet_of(self.user, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("75"), Decimal("0")))

    def test_cannot_capture_more_than_held(self):
        with self.assertRaises(ledger.InsufficientFunds):
            with transaction.atomic():
                ledger.capture(self.wallet.pk, Decimal("1"))

    def test_database_itself_refuses_a_negative_balance(self):
        # Even bypassing all application code.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Wallet.objects.filter(pk=self.wallet.pk).update(balance=Decimal("-1"))


class TransactionSecurityTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.bob_wallet = fund(self.bob, "GHS", 0.01)

    def test_clients_cannot_create_transactions_at_all(self):
        self.client.force_authenticate(self.alice)
        r = self.client.post(
            "/api/transactions/",
            {"wallet": str(self.bob_wallet.pk), "transaction_type": "fiat_payout", "amount": "10",
             "currency": "GHS", "idempotency_key": "k1"},
            format="json",
        )
        self.assertEqual(r.status_code, 405)
        self.assertFalse(Transaction.objects.filter(user=self.alice).exists())

    def test_users_only_see_their_own_transactions(self):
        txn = Transaction.objects.create(
            user=self.bob, wallet=self.bob_wallet, transaction_type="wallet_load",
            amount=Decimal("5"), currency="GHS", idempotency_key="b1",
        )
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get("/api/transactions/").json(), [])
        self.assertEqual(self.client.get(f"/api/transactions/{txn.pk}/").status_code, 404)

    def test_internal_bookkeeping_is_not_exposed_to_clients(self):
        txn = Transaction.objects.create(
            user=self.bob, wallet=self.bob_wallet, transaction_type="fiat_payout",
            amount=Decimal("5"), currency="GHS", idempotency_key="b2",
            metadata={"hold": "held", "dispatched_at": "x", "destination": {"network": "mtn"}},
        )
        self.client.force_authenticate(self.bob)
        meta = self.client.get(f"/api/transactions/{txn.pk}/").json()["metadata"]
        self.assertEqual(meta, {"destination": {"network": "mtn"}})

    def test_zero_or_negative_amounts_are_rejected_by_the_database(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Transaction.objects.create(
                    user=self.bob, wallet=self.bob_wallet, transaction_type="wallet_load",
                    amount=Decimal("0"), currency="GHS", idempotency_key="z",
                )


class SettlementSafetyTests(APITestCase):
    def setUp(self):
        self.user = make_user("carol")
        self.wallet = wallet_of(self.user, "GHS")
        self.admin = make_user("boss", staff=True)

    def _verified_load(self, amount="50", key="s1"):
        return Transaction.objects.create(
            user=self.user, wallet=self.wallet, transaction_type="wallet_load",
            status="verified", amount=Decimal(amount), currency="GHS", idempotency_key=key,
        )

    def test_a_settled_transaction_cannot_be_reopened_and_settled_again(self):
        txn = self._verified_load()
        with transaction.atomic():
            txn.status = "settled"
            txn.save()
        self.assertEqual(wallet_of(self.user, "GHS").balance, Decimal("50"))

        txn.status = "verified"
        with self.assertRaises(ledger.InvalidTransition):
            with transaction.atomic():
                txn.save()
        self.assertEqual(wallet_of(self.user, "GHS").balance, Decimal("50"))

    def test_admin_settle_twice_credits_once(self):
        txn = self._verified_load("80", "s2")
        self.client.force_authenticate(self.admin)
        first = self.client.post(f"/api/admin/transactions/{txn.pk}/settle/")
        second = self.client.post(f"/api/admin/transactions/{txn.pk}/settle/")
        self.assertEqual((first.status_code, second.status_code), (200, 400))
        self.assertEqual(wallet_of(self.user, "GHS").balance, Decimal("80"))

    def test_settling_without_an_atomic_block_is_refused_loudly(self):
        # In TestCase everything is atomic, so simulate the check directly.
        from django.db import connection
        with self.assertRaises(ledger.NotInAtomicBlock):
            # bypass TestCase's wrapping transaction by calling the guard's condition
            original = connection.in_atomic_block
            try:
                connection.in_atomic_block = False
                ledger.require_atomic()
            finally:
                connection.in_atomic_block = original

    def test_flagged_transaction_can_be_resolved_by_admin(self):
        txn = Transaction.objects.create(
            user=self.user, wallet=self.wallet, transaction_type="wallet_load",
            status="flagged", amount=Decimal("10"), currency="GHS", idempotency_key="s3",
        )
        self.client.force_authenticate(self.admin)
        r = self.client.post(f"/api/admin/transactions/{txn.pk}/transition/", {"status": "verified"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "verified")

    def test_crypto_trade_cannot_settle_without_the_paying_balance(self):
        ghs = self.wallet
        btc = wallet_of(self.user, "BTC")
        txn = Transaction.objects.create(
            user=self.user, wallet=btc, counter_wallet=ghs, transaction_type="crypto_trade",
            amount=Decimal("0.001"), currency="BTC", idempotency_key="t1",
            metadata={"counter_amount": "500"},
        )
        with self.assertRaises(ledger.InsufficientFunds):
            with transaction.atomic():
                txn.status = "settled"
                txn.save()
        self.assertEqual(wallet_of(self.user, "BTC").balance, Decimal("0"))
