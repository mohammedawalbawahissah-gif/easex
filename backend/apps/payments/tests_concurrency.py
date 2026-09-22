"""
Race-condition tests. These use real threads, each with its own database
connection, against real PostgreSQL row locking — the thing that
actually protects money in production. (They're skipped on databases
without row-level locking, where they'd prove nothing.)
"""

import threading
from decimal import Decimal

from django.db import connection, connections
from django.test import TransactionTestCase, skipUnlessDBFeature

from apps.transactions import ledger
from apps.transactions.models import Transaction
from apps.wallets.models import Wallet

from . import services
from .services import PaymentError
from .testing import fund, make_user, total_money, wallet_of


def run_concurrently(fn, args_list):
    """Run fn(*args) in parallel threads, released together. Returns results/exceptions."""
    barrier = threading.Barrier(len(args_list))
    results = [None] * len(args_list)

    def worker(i, args):
        try:
            barrier.wait()
            results[i] = ("ok", fn(*args))
        except Exception as exc:  # noqa: BLE001 - we want to inspect every outcome
            results[i] = ("err", exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i, a)) for i, a in enumerate(args_list)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    return results


@skipUnlessDBFeature("has_select_for_update")
class ConcurrencyTests(TransactionTestCase):
    serialized_rollback = True  # keep data-migration seed rows (exchange rates) between tests

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def transfer(self, sender, recipient, amount, key):
        return services.execute_transfer(
            sender=sender, recipient=recipient, currency="GHS", amount=amount, note="", idempotency_key=key
        )

    def test_simultaneous_transfers_cannot_spend_the_same_money_twice(self):
        fund(self.alice, "GHS", 50)
        results = run_concurrently(self.transfer, [(self.alice, self.bob, "10", f"race-key-{i:04d}") for i in range(12)])

        ok = [r for r in results if r[0] == "ok"]
        errors = [r[1] for r in results if r[0] == "err"]
        self.assertEqual(len(ok), 5)
        self.assertTrue(all(isinstance(e, PaymentError) and e.code == "insufficient_funds" for e in errors), errors)
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("0"))
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("50"))
        self.assertEqual(total_money("GHS"), Decimal("50"))

    def test_duplicate_submissions_of_one_request_execute_once(self):
        fund(self.alice, "GHS", 100)
        results = run_concurrently(self.transfer, [(self.alice, self.bob, "30", "same-key-0001")] * 8)
        self.assertTrue(all(r[0] == "ok" for r in results), [r for r in results if r[0] == "err"])
        self.assertEqual(sum(1 for r in results if r[1][1] is True), 1)  # exactly one "created"
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("30"))
        self.assertEqual(Transaction.objects.filter(transaction_type="transfer_out").count(), 1)

    def test_people_paying_each_other_at_once_never_deadlock(self):
        fund(self.alice, "GHS", 500)
        fund(self.bob, "GHS", 500)
        jobs = []
        for i in range(10):
            jobs.append((self.alice, self.bob, "7", f"a-to-b-{i:05d}"))
            jobs.append((self.bob, self.alice, "3", f"b-to-a-{i:05d}"))
        results = run_concurrently(self.transfer, jobs)
        self.assertTrue(all(r[0] == "ok" for r in results), [r for r in results if r[0] == "err"])
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("500") - 70 + 30)
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("500") + 70 - 30)
        self.assertEqual(total_money("GHS"), Decimal("1000"))

    def test_two_admins_settling_the_same_transaction_credit_it_once(self):
        wallet = wallet_of(self.alice, "GHS")
        txn = Transaction.objects.create(
            user=self.alice, wallet=wallet, transaction_type="wallet_load", status="verified",
            amount=Decimal("80"), currency="GHS", idempotency_key="settle-race-1",
        )
        results = run_concurrently(
            lambda: ledger.settle_transaction(txn.pk, from_statuses=["verified"]), [()] * 6
        )
        self.assertEqual(sum(1 for r in results if r[0] == "ok"), 1)
        self.assertTrue(all(isinstance(r[1], ledger.InvalidTransition) for r in results if r[0] == "err"))
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("80"))

    def test_concurrent_withdrawals_cannot_hold_more_than_the_balance(self):
        fund(self.alice, "GHS", 1000)
        dest = services.add_destination(user=self.alice, network="mtn", account_number="0244123456", account_name="Ama A")
        results = run_concurrently(
            lambda i: services.request_withdrawal(
                user=self.alice, currency="GHS", amount="300", idempotency_key=f"wd-race-{i:05d}", destination_id=dest.pk
            ),
            [(i,) for i in range(8)],
        )
        self.assertEqual(sum(1 for r in results if r[0] == "ok"), 3)
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("100"), Decimal("900")))

    def test_the_daily_limit_holds_under_concurrency(self):
        basic = make_user("basic1", tier="basic")  # 2,000 / day
        fund(basic, "GHS", 10_000)
        dest = services.add_destination(user=basic, network="mtn", account_number="0244765432", account_name="Bo Basic")
        results = run_concurrently(
            lambda i: services.request_withdrawal(
                user=basic, currency="GHS", amount="500", idempotency_key=f"lim-race-{i:05d}", destination_id=dest.pk
            ),
            [(i,) for i in range(8)],
        )
        self.assertEqual(sum(1 for r in results if r[0] == "ok"), 4)  # 4 x 500 = 2,000, no more
        self.assertTrue(all(isinstance(r[1], PaymentError) and r[1].code == "limit_exceeded" for r in results if r[0] == "err"))

    def test_no_wallet_ever_goes_negative_under_a_mixed_storm(self):
        fund(self.alice, "GHS", 100)
        fund(self.bob, "GHS", 100)
        jobs = []
        for i in range(15):
            jobs.append((self.alice, self.bob, "9", f"m-a-{i:06d}"))
            jobs.append((self.bob, self.alice, "11", f"m-b-{i:06d}"))
        run_concurrently(self.transfer, jobs)
        self.assertFalse(Wallet.objects.filter(balance__lt=0).exists())
        self.assertEqual(total_money("GHS"), Decimal("200"))
