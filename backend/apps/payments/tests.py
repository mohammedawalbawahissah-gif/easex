from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.notifications.models import Notification
from apps.transactions.models import Transaction
from apps.wallets.models import Wallet

from . import services
from .models import PaymentSettings, ScheduledTransfer
from .providers import ProviderResult, get_provider
from .testing import PASSWORD, PIN, fund, make_user, total_money, wallet_of

STUB = override_settings(PAYMENTS_PROVIDER="stub", DEBUG=True)
_key = iter(f"key-{i:08d}" for i in range(10_000))


def k():
    return next(_key)


class Base(APITestCase):
    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.admin = make_user("boss", staff=True)

    def as_user(self, user):
        self.client.force_authenticate(user)

    def post(self, path, data, user=None):
        if user:
            self.as_user(user)
        return self.client.post(path, data, format="json")


# ---------------------------------------------------------------------------
class ProviderSafetyTests(APITestCase):
    def test_default_provider_is_manual(self):
        self.assertEqual(get_provider().name, "manual")

    @override_settings(PAYMENTS_PROVIDER="stub", DEBUG=False)
    def test_stub_provider_refuses_to_run_outside_debug(self):
        with self.assertRaises(ImproperlyConfigured):
            get_provider()

    def test_settings_refuse_to_boot_with_stub_in_production(self):
        import importlib, os
        from config import settings as s
        env = {"DJANGO_DEBUG": "False", "PAYMENTS_PROVIDER": "stub", "DJANGO_SECRET_KEY": "x" * 40}
        with mock.patch.dict(os.environ, env):
            with self.assertRaises(ImproperlyConfigured):
                importlib.reload(s)
        importlib.reload(s)


# ---------------------------------------------------------------------------
class LoadWalletTests(Base):
    def payload(self, **kw):
        return {"amount": "100.00", "network": "mtn", "phone_number": "0244123456", "idempotency_key": k(), **kw}

    def test_manual_load_waits_for_an_admin_then_credits(self):
        PaymentSettings.get().manual_deposit_instructions = "Send to 024XXXXXXX"
        PaymentSettings.get().save()
        r = self.post("/api/payments/load/", self.payload(), self.alice)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["status"], "under_review")
        self.assertTrue(body["metadata"]["reference"].startswith("EX-"))
        self.assertEqual(wallet_of(self.alice, "GHS").balance, 0)  # nothing yet

        self.as_user(self.admin)
        tid = body["id"]
        self.assertEqual(self.client.post(f"/api/admin/transactions/{tid}/transition/", {"status": "verified"}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/admin/transactions/{tid}/settle/").status_code, 200)
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("100"))

    @STUB
    def test_stub_load_settles_instantly(self):
        r = self.post("/api/payments/load/", self.payload(), self.alice)
        self.assertEqual(r.json()["status"], "settled")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("100"))

    @STUB
    def test_replaying_the_same_request_does_not_load_twice(self):
        data = self.payload()
        a = self.post("/api/payments/load/", data, self.alice)
        b = self.post("/api/payments/load/", data, self.alice)
        self.assertEqual((a.status_code, b.status_code), (201, 200))
        self.assertEqual(a.json()["id"], b.json()["id"])
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("100"))

    def test_unverified_users_cannot_load(self):
        u = make_user(tier="unverified")
        r = self.post("/api/payments/load/", self.payload(), u)
        self.assertEqual((r.status_code, r.json()["code"]), (400, "kyc_required"))

    @STUB
    def test_daily_limit_applies_to_the_rolling_total(self):
        basic = make_user(tier="basic")  # 2000 / day
        self.assertEqual(self.post("/api/payments/load/", self.payload(amount="1500"), basic).status_code, 201)
        r = self.post("/api/payments/load/", self.payload(amount="600"), basic)
        self.assertEqual(r.json()["code"], "limit_exceeded")

    def test_rejects_bad_input(self):
        for bad in [{"amount": "0"}, {"amount": "-5"}, {"amount": "1.005"}, {"phone_number": "12345"}, {"network": "visa"}]:
            self.assertEqual(self.post("/api/payments/load/", self.payload(**bad), self.alice).status_code, 400, bad)

    def test_kill_switch(self):
        ps = PaymentSettings.get(); ps.loads_enabled = False; ps.save()
        self.assertEqual(self.post("/api/payments/load/", self.payload(), self.alice).json()["code"], "paused")

    def test_crypto_deposit_address_unavailable_with_manual_provider(self):
        self.as_user(self.alice)
        r = self.client.get("/api/payments/deposit-address/?currency=BTC&network=bitcoin")
        self.assertEqual((r.status_code, r.json()["code"]), (400, "unavailable"))

    @STUB
    def test_stub_deposit_address_is_stable_and_obviously_fake(self):
        self.as_user(self.alice)
        a = self.client.get("/api/payments/deposit-address/?currency=USDT&network=trc20").json()
        b = self.client.get("/api/payments/deposit-address/?currency=USDT&network=trc20").json()
        self.assertEqual(a, b)
        self.assertTrue(a["address"].startswith("TESTONLY-"))

    def test_deposit_wrong_network_rejected(self):
        self.as_user(self.alice)
        r = self.client.get("/api/payments/deposit-address/?currency=BTC&network=trc20")
        self.assertEqual(r.status_code, 400)

    def test_same_onchain_deposit_can_never_be_credited_twice(self):
        for _ in range(3):
            services.credit_crypto_deposit(user=self.alice, currency="BTC", amount="0.5", network="bitcoin", tx_hash="abc123")
        self.assertEqual(wallet_of(self.alice, "BTC").balance, Decimal("0.5"))


# ---------------------------------------------------------------------------
class WithdrawalTests(Base):
    def setUp(self):
        super().setUp()
        fund(self.alice, "GHS", 1000)
        self.dest = services.add_destination(user=self.alice, network="mtn", account_number="0244123456", account_name="Alice A")

    def withdraw(self, user=None, **kw):
        data = {"currency": "GHS", "amount": "200", "destination_id": str(self.dest.pk),
                "pin": PIN, "idempotency_key": k(), **kw}
        return self.post("/api/payments/withdraw/", data, user or self.alice)

    def test_request_holds_funds_and_waits_for_review_by_default(self):
        r = self.withdraw()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["status"], "under_review")
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("800"), Decimal("200")))

    def test_held_funds_cannot_be_spent_twice(self):
        self.withdraw(amount="900")
        r = self.withdraw(amount="200")  # only 100 spendable left
        self.assertEqual(r.json()["code"], "insufficient_funds")

    def test_admin_approves_then_marks_paid_releases_hold_for_good(self):
        tid = self.withdraw().json()["id"]
        self.as_user(self.admin)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(f"/api/admin/transactions/{tid}/transition/", {"status": "verified"}, format="json")
        t = Transaction.objects.get(pk=tid)
        self.assertEqual(t.status, "verified")  # manual provider: waits for a human to actually pay
        self.assertEqual(t.metadata["provider_state"], "pending")

        self.assertEqual(self.client.post(f"/api/admin/transactions/{tid}/settle/").status_code, 200)
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("800"), Decimal("0")))
        self.assertEqual(Transaction.objects.get(pk=tid).metadata["hold"], "captured")

    def test_admin_rejection_returns_the_money(self):
        tid = self.withdraw().json()["id"]
        self.as_user(self.admin)
        self.client.post(f"/api/admin/transactions/{tid}/transition/", {"status": "rejected", "reason": "Name mismatch"}, format="json")
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("1000"), Decimal("0")))
        body = Notification.objects.filter(user=self.alice).first().body
        self.assertIn("back in your wallet", body)
        self.assertIn("Name mismatch", body)

    @STUB
    def test_small_withdrawals_can_skip_review_when_the_operator_allows_it(self):
        ps = PaymentSettings.get(); ps.withdrawal_auto_approve_max_ghs = Decimal("250"); ps.save()
        with self.captureOnCommitCallbacks(execute=True):
            r = self.withdraw(amount="200")
        t = Transaction.objects.get(pk=r.json()["id"])
        self.assertEqual(t.status, "settled")
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("800"), Decimal("0")))
        # above the threshold it still waits
        self.assertEqual(self.withdraw(amount="300").json()["status"], "under_review")

    @STUB
    def test_provider_declining_a_payout_refunds_the_user(self):
        ps = PaymentSettings.get(); ps.withdrawal_auto_approve_max_ghs = Decimal("500"); ps.save()
        with mock.patch("apps.payments.providers.StubPaymentProvider.send_fiat_payout",
                        return_value=ProviderResult("failed", message="Account not found")):
            with self.captureOnCommitCallbacks(execute=True):
                r = self.withdraw()
        t = Transaction.objects.get(pk=r.json()["id"])
        self.assertEqual(t.status, "rejected")
        w = wallet_of(self.alice, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("1000"), Decimal("0")))

    @STUB
    def test_provider_crashing_never_double_sends_and_keeps_funds_held(self):
        ps = PaymentSettings.get(); ps.withdrawal_auto_approve_max_ghs = Decimal("500"); ps.save()
        with mock.patch("apps.payments.providers.StubPaymentProvider.send_fiat_payout", side_effect=TimeoutError("boom")) as m:
            with self.captureOnCommitCallbacks(execute=True):
                r = self.withdraw()
            tid = r.json()["id"]
            services.execute_withdrawal(tid)  # a retry / sweeper must NOT call the provider again
            services.dispatch_stuck_withdrawals()
        self.assertEqual(m.call_count, 1)
        t = Transaction.objects.get(pk=tid)
        self.assertEqual(t.status, "verified")
        self.assertTrue(t.metadata["needs_reconciliation"])
        self.assertEqual(wallet_of(self.alice, "GHS").escrow_balance, Decimal("200"))

    def test_wrong_pin_is_refused_and_nothing_moves(self):
        r = self.withdraw(pin="111222")
        self.assertEqual((r.status_code, r.json()["code"]), (400, "bad_pin"))
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("1000"))

    def test_replay_holds_only_once(self):
        key = k()
        self.withdraw(idempotency_key=key)
        r = self.withdraw(idempotency_key=key)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(wallet_of(self.alice, "GHS").escrow_balance, Decimal("200"))

    def test_cannot_withdraw_to_someone_elses_saved_account(self):
        bob_dest = services.add_destination(user=self.bob, network="mtn", account_number="0244999999", account_name="Bob B")
        r = self.withdraw(destination_id=str(bob_dest.pk))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(wallet_of(self.alice, "GHS").escrow_balance, 0)

    def test_rolling_daily_limit(self):
        basic = make_user(tier="basic")  # 2000/day
        fund(basic, "GHS", 5000)
        d = services.add_destination(user=basic, network="mtn", account_number="0244777777", account_name="Bob B")
        ok = self.withdraw(user=basic, amount="1500", destination_id=str(d.pk))
        over = self.withdraw(user=basic, amount="600", destination_id=str(d.pk))
        self.assertEqual((ok.status_code, over.json()["code"]), (201, "limit_exceeded"))

    def test_flagged_and_unverified_users_cannot_withdraw(self):
        flagged = make_user(flagged=True); fund(flagged, "GHS", 100)
        d = services.add_destination(user=flagged, network="mtn", account_number="0244555555", account_name="Fay F")
        self.assertEqual(self.withdraw(user=flagged, destination_id=str(d.pk)).json()["code"], "account_flagged")

    def test_kill_switch_pauses_withdrawals(self):
        ps = PaymentSettings.get(); ps.withdrawals_enabled = False; ps.save()
        self.assertEqual(self.withdraw().json()["code"], "paused")

    # ---- crypto ----
    def test_crypto_withdrawal_validates_address_and_network(self):
        fund(self.alice, "BTC", 1)
        btc = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        eth = "0x52908400098527886E0F7030069857D2E4169EE7"
        base = {"currency": "BTC", "amount": "0.0001", "pin": PIN}
        good = self.post("/api/payments/withdraw/", {**base, "address": btc, "network": "bitcoin", "idempotency_key": k()}, self.alice)
        self.assertEqual(good.status_code, 201, good.content)
        self.assertEqual(good.json()["transaction_type"], "crypto_withdrawal")
        wrong_chain = self.post("/api/payments/withdraw/", {**base, "address": eth, "network": "bitcoin", "idempotency_key": k()}, self.alice)
        wrong_net = self.post("/api/payments/withdraw/", {**base, "address": btc, "network": "erc20", "idempotency_key": k()}, self.alice)
        self.assertEqual((wrong_chain.status_code, wrong_net.status_code), (400, 400))
        self.assertEqual(wallet_of(self.alice, "BTC").escrow_balance, Decimal("0.0001"))

    def test_usdt_needs_a_network_and_the_address_must_match_it(self):
        fund(self.alice, "USDT", 500)
        tron = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"
        r = lambda **kw: self.post("/api/payments/withdraw/", {"currency": "USDT", "amount": "10", "pin": PIN, "idempotency_key": k(), **kw}, self.alice)
        self.assertEqual(r(address=tron, network="trc20").status_code, 201)
        self.assertEqual(r(address=tron, network="erc20").status_code, 400)  # tron address on an EVM network
        self.assertEqual(r(address=tron, network="").status_code, 400)

    def test_memo_only_on_networks_that_use_it_and_must_be_numeric(self):
        fund(self.alice, "XRP", 100)
        xrp = "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh"
        r = lambda **kw: self.post("/api/payments/withdraw/", {"currency": "XRP", "amount": "5", "pin": PIN, "idempotency_key": k(), "address": xrp, "network": "xrp", **kw}, self.alice)
        self.assertEqual(r(memo="123456").status_code, 201)
        self.assertEqual(r(memo="abc").status_code, 400)

    def test_amount_precision_is_enforced(self):
        self.assertEqual(self.withdraw(amount="10.001").status_code, 400)


# ---------------------------------------------------------------------------
class TransferTests(Base):
    def setUp(self):
        super().setUp()
        for cur, amt in [("GHS", 500), ("BTC", 1), ("ETH", 10), ("USDT", 1000), ("USDC", 1000),
                         ("BNB", 10), ("SOL", 50), ("XRP", 1000), ("ADA", 1000), ("DOGE", 5000), ("LTC", 20)]:
            fund(self.alice, cur, amt)

    def send(self, to="bob", cur="GHS", amount="50", user=None, **kw):
        return self.post("/api/payments/transfers/", {"recipient": to, "currency": cur, "amount": amount,
                         "pin": PIN, "idempotency_key": k(), **kw}, user or self.alice)

    def test_every_supported_currency_can_be_transferred(self):
        # Small amounts: each must stay under the 50,000 GHS daily limit even
        # for BTC (the limit itself is tested separately).
        small = {"GHS": "5", "BTC": "0.0001", "ETH": "0.001", "USDT": "5", "USDC": "5", "BNB": "0.01",
                 "SOL": "0.01", "XRP": "5", "ADA": "5", "DOGE": "5", "LTC": "0.01"}
        for cur, _ in Wallet.Currency.choices:
            amt = small[cur]
            before = total_money(cur)
            r = self.send(cur=cur, amount=amt)
            self.assertEqual(r.status_code, 201, (cur, r.content))
            self.assertEqual(total_money(cur), before, f"{cur}: money was created or destroyed")
            self.assertGreater(wallet_of(self.bob, cur).balance, 0)

    def test_creates_two_linked_rows_and_notifies_both_sides(self):
        r = self.send(amount="75", note="rent")
        out = Transaction.objects.get(pk=r.json()["id"])
        inn = Transaction.objects.get(pk=out.metadata["peer"])
        self.assertEqual((out.user, out.transaction_type, out.status), (self.alice, "transfer_out", "settled"))
        self.assertEqual((inn.user, inn.transaction_type, inn.status), (self.bob, "transfer_in", "settled"))
        self.assertEqual(inn.metadata["counterparty_username"], "alice")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("425"))
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("75"))
        self.assertTrue(Notification.objects.filter(user=self.bob, title="Money received", body__contains="@alice").exists())
        self.assertTrue(Notification.objects.filter(user=self.alice, title="Transfer sent", body__contains="@bob").exists())

    def test_recipient_can_be_found_by_phone_in_any_common_format(self):
        local = "0" + self.bob.phone_number[4:]
        for ident in [self.bob.phone_number, self.bob.phone_number.lstrip("+"), local, "@BOB", "Bob"]:
            r = self.send(to=ident, amount="1")
            self.assertEqual(r.status_code, 201, (ident, r.content))

    def test_cannot_overdraw_or_send_to_yourself_or_a_stranger(self):
        self.assertEqual(self.send(amount="501").json()["code"], "insufficient_funds")
        self.assertEqual(self.send(to="alice").status_code, 400)
        self.assertEqual(self.send(to="nobody").json()["code"], "recipient_not_found")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("500"))

    def test_disabled_recipient_is_treated_as_not_found(self):
        self.bob.is_active = False; self.bob.save()
        self.assertEqual(self.send().json()["code"], "recipient_not_found")

    def test_failed_transfer_leaves_no_partial_rows(self):
        self.send(amount="9999")
        self.assertFalse(Transaction.objects.filter(transaction_type__in=["transfer_out", "transfer_in"]).exists())

    def test_wrong_pin_and_replay(self):
        self.assertEqual(self.send(pin="999888").json()["code"], "bad_pin")
        key = k()
        self.send(idempotency_key=key); r = self.send(idempotency_key=key)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("50"))

    def test_lookup_returns_only_a_masked_name(self):
        self.as_user(self.alice)
        r = self.client.post("/api/payments/transfers/lookup/", {"identifier": "bob"}, format="json")
        self.assertEqual(r.json(), {"display_name": "b•••b"})
        self.assertEqual(self.client.post("/api/payments/transfers/lookup/", {"identifier": "zzz"}, format="json").status_code, 400)

    def test_transfers_respect_flags_kyc_and_the_kill_switch(self):
        self.alice.is_flagged = True; self.alice.save()
        self.assertEqual(self.send().json()["code"], "account_flagged")
        self.alice.is_flagged = False; self.alice.kyc_tier = "unverified"; self.alice.save()
        self.assertEqual(self.send().json()["code"], "kyc_required")
        self.alice.kyc_tier = "full"; self.alice.save()
        ps = PaymentSettings.get(); ps.transfers_enabled = False; ps.save()
        self.assertEqual(self.send().json()["code"], "paused")

    def test_crypto_transfer_counts_against_the_ghs_limit(self):
        basic = make_user(tier="basic"); fund(basic, "BTC", 5)
        # one BTC is worth far more than the 2,000 GHS basic limit
        r = self.send(user=basic, cur="BTC", amount="1")
        self.assertEqual(r.json()["code"], "limit_exceeded")

    def test_history_chart_helper_types_are_credit_or_debit_as_expected(self):
        # mirrors packages/shared walletHistory: out = debit, in = credit
        self.send(amount="10")
        self.assertEqual(Transaction.objects.filter(user=self.alice, transaction_type="transfer_out").count(), 1)


# ---------------------------------------------------------------------------
class ScheduledTransferTests(Base):
    def setUp(self):
        super().setUp()
        fund(self.alice, "GHS", 500)

    def schedule(self, minutes=10, user=None, **kw):
        data = {"recipient": "bob", "currency": "GHS", "amount": "100", "pin": PIN,
                "run_at": (timezone.now() + timedelta(minutes=minutes)).isoformat(),
                "idempotency_key": k(), **kw}
        return self.post("/api/payments/scheduled-transfers/", data, user or self.alice)

    def make_due(self, sid, ago=timedelta(minutes=1)):
        ScheduledTransfer.objects.filter(pk=sid).update(run_at=timezone.now() - ago)

    def test_scheduling_moves_no_money_until_it_runs(self):
        r = self.schedule()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("500"))
        self.assertEqual(services.run_due_scheduled_transfers(), 0)

    def test_due_transfer_runs_exactly_once(self):
        sid = self.schedule().json()["id"]
        self.make_due(sid)
        self.assertEqual(services.run_due_scheduled_transfers(), 1)
        self.assertEqual(services.run_due_scheduled_transfers(), 0)  # second tick: nothing left
        st = ScheduledTransfer.objects.get(pk=sid)
        self.assertEqual(st.status, "completed")
        self.assertEqual(st.transaction.transaction_type, "transfer_out")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("400"))
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("100"))

    def test_running_the_same_one_concurrently_or_twice_directly_is_harmless(self):
        sid = self.schedule().json()["id"]
        self.make_due(sid)
        services.process_scheduled_transfer(sid)
        services.process_scheduled_transfer(sid)
        self.assertEqual(wallet_of(self.bob, "GHS").balance, Decimal("100"))

    def test_insufficient_funds_at_run_time_fails_and_tells_the_user(self):
        sid = self.schedule(amount="400").json()["id"]
        from apps.payments.testing import wallet_of as w
        Wallet.objects.filter(pk=w(self.alice, "GHS").pk).update(balance=Decimal("10"))
        self.make_due(sid)
        services.run_due_scheduled_transfers()
        st = ScheduledTransfer.objects.get(pk=sid)
        self.assertEqual(st.status, "failed")
        self.assertIn("Insufficient", st.failure_reason)
        self.assertTrue(Notification.objects.filter(user=self.alice, title__icontains="Scheduled transfer").exists())
        self.assertEqual(wallet_of(self.bob, "GHS").balance, 0)

    def test_revalidated_at_run_time_flagged_sender_is_blocked(self):
        sid = self.schedule().json()["id"]
        self.alice.is_flagged = True; self.alice.save()
        self.make_due(sid)
        services.run_due_scheduled_transfers()
        self.assertEqual(ScheduledTransfer.objects.get(pk=sid).status, "failed")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("500"))

    def test_stale_transfers_are_not_run_after_a_long_outage(self):
        sid = self.schedule().json()["id"]
        self.make_due(sid, ago=timedelta(hours=7))
        services.run_due_scheduled_transfers()
        self.assertEqual(ScheduledTransfer.objects.get(pk=sid).status, "failed")
        self.assertEqual(wallet_of(self.alice, "GHS").balance, Decimal("500"))

    def test_cancel_before_it_runs(self):
        sid = self.schedule().json()["id"]
        self.assertEqual(self.post(f"/api/payments/scheduled-transfers/{sid}/cancel/", {}, self.alice).json()["status"], "cancelled")
        self.make_due(sid)
        self.assertEqual(services.run_due_scheduled_transfers(), 0)

    def test_cannot_cancel_after_it_ran_or_cancel_someone_elses(self):
        sid = self.schedule().json()["id"]
        self.assertEqual(self.post(f"/api/payments/scheduled-transfers/{sid}/cancel/", {}, self.bob).status_code, 400)
        self.make_due(sid); services.run_due_scheduled_transfers()
        self.assertEqual(self.post(f"/api/payments/scheduled-transfers/{sid}/cancel/", {}, self.alice).json()["code"], "not_cancellable")

    def test_time_bounds_and_pin(self):
        self.assertEqual(self.schedule(minutes=-5).status_code, 400)
        self.assertEqual(self.schedule(minutes=60 * 24 * 400).status_code, 400)
        self.assertEqual(self.schedule(pin="121212").json()["code"], "bad_pin")
        naive = self.post("/api/payments/scheduled-transfers/", {"recipient": "bob", "currency": "GHS", "amount": "1", "pin": PIN, "run_at": "2099-01-01T10:00:00", "idempotency_key": k()}, self.alice)
        self.assertEqual(naive.status_code, 400)

    def test_replay_and_list_only_shows_own(self):
        data_key = k()
        a = self.schedule(idempotency_key=data_key); b = self.schedule(idempotency_key=data_key)
        self.assertEqual((a.status_code, b.status_code, a.json()["id"] == b.json()["id"]), (201, 200, True))
        self.as_user(self.alice); self.assertEqual(len(self.client.get("/api/payments/scheduled-transfers/").json()), 1)
        self.as_user(self.bob); self.assertEqual(self.client.get("/api/payments/scheduled-transfers/").json(), [])

    def test_a_single_transfer_above_the_daily_limit_is_refused_up_front(self):
        basic = make_user(tier="basic")
        self.assertEqual(self.schedule(user=basic, amount="2500").json()["code"], "limit_exceeded")

    def test_cap_on_active_schedules(self):
        for _ in range(services.MAX_ACTIVE_SCHEDULED):
            self.assertEqual(self.schedule(amount="1").status_code, 201)
        self.assertEqual(self.schedule(amount="1").status_code, 400)


# ---------------------------------------------------------------------------
class DestinationAndPreferenceTests(Base):
    def test_add_requires_password_and_normalises_the_number(self):
        bad = self.post("/api/payments/destinations/", {"network": "mtn", "account_number": "0244123456", "account_name": "Ama A", "password": "x"}, self.alice)
        self.assertEqual(bad.json()["code"], "bad_password")
        ok = self.post("/api/payments/destinations/", {"network": "mtn", "account_number": "+233 24 412 3456", "account_name": "Alice A", "password": PASSWORD}, self.alice)
        self.assertEqual((ok.status_code, ok.json()["account_number"]), (201, "0244123456"))
        self.assertTrue(Notification.objects.filter(user=self.alice, title="Payout account added").exists())

    def test_duplicate_and_invalid_numbers_rejected(self):
        services.add_destination(user=self.alice, network="mtn", account_number="0244123456", account_name="Ama A")
        for number in ["0244123456", "12345", "0844123456"]:
            r = self.post("/api/payments/destinations/", {"network": "mtn", "account_number": number, "account_name": "Ama A", "password": PASSWORD}, self.alice)
            self.assertEqual(r.status_code, 400, number)

    def test_removing_the_destination_switches_auto_payout_off(self):
        d = services.add_destination(user=self.alice, network="mtn", account_number="0244123456", account_name="Ama A")
        services.set_auto_payout(user=self.alice, enabled=True, destination_id=d.pk)
        self.as_user(self.alice)
        self.assertEqual(self.client.delete(f"/api/payments/destinations/{d.pk}/").status_code, 204)
        self.assertFalse(self.client.get("/api/payments/payout-preference/").json()["auto_payout_enabled"])

    def test_enabling_auto_payout_needs_password_and_a_destination(self):
        self.assertEqual(self.post("/api/payments/payout-preference/", {}, self.alice).status_code, 405)
        self.as_user(self.alice)
        r = self.client.put("/api/payments/payout-preference/", {"auto_payout_enabled": True, "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 400)  # no destination chosen
        d = services.add_destination(user=self.alice, network="mtn", account_number="0244123456", account_name="Ama A")
        r = self.client.put("/api/payments/payout-preference/", {"auto_payout_enabled": True, "destination_id": str(d.pk), "password": PASSWORD}, format="json")
        self.assertEqual((r.status_code, r.json()["auto_payout_enabled"]), (200, True))

    def test_config_endpoint_reports_limits(self):
        self.as_user(self.alice)
        c = self.client.get("/api/payments/config/").json()
        self.assertEqual(c["daily_limit_ghs"], "50000")
        self.assertIn("trc20", [n["value"] for n in c["crypto_networks"]["USDT"]])
        self.assertFalse(c["giftcard_auto_payment_enabled"])


class ThrottlingTests(Base):
    def test_money_moving_calls_are_rate_limited_but_reads_are_not(self):
        from django.core.cache import cache
        from rest_framework.throttling import ScopedRateThrottle

        cache.clear()
        fund(self.alice, "GHS", 500)
        with mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"money_out": "3/min", "money": "1000/min"}):
            codes = [
                self.post("/api/payments/transfers/", {"recipient": "bob", "currency": "GHS", "amount": "1",
                          "pin": "654321", "idempotency_key": k()}, self.alice).status_code
                for _ in range(5)
            ]
            self.assertEqual(codes, [400, 400, 400, 429, 429])  # PIN guessing stops after 3
            for _ in range(10):  # reading your own data is unaffected
                self.assertEqual(self.client.get("/api/payments/scheduled-transfers/").status_code, 200)
        cache.clear()
