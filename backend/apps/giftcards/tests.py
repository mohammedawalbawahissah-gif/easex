from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib import admin as django_admin
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.compliance.models import AuditLog, ComplianceFlag
from apps.notifications.models import Notification
from apps.payments import services as payments
from apps.payments.models import PaymentSettings
from apps.payments.providers import ProviderResult
from apps.payments.testing import PASSWORD, fund, make_user, wallet_of
from apps.transactions.models import Transaction

from .models import GiftCardBrand, GiftCardSubcategory, GiftCardSubmission

STUB = override_settings(PAYMENTS_PROVIDER="stub", DEBUG=True)
_n = iter(range(1, 10_000))


def catalog_sub(brand_slug, sub_slug, rate=None, **fields):
    """A seeded catalog subcategory, optionally priced (rates are deliberately not seeded)."""
    sub = GiftCardSubcategory.objects.select_related("brand").get(brand__slug=brand_slug, slug=sub_slug)
    if rate is not None:
        sub.rate = Decimal(str(rate))
    for k, v in fields.items():
        setattr(sub, k, v)
    sub.save()
    return sub


class Base(APITestCase):
    def setUp(self):
        self.seller = make_user("seller")
        self.admin = make_user("boss", staff=True)
        # Amazon USA e-code at 0.85 GHS per USD keeps the arithmetic below easy to read.
        self.amazon = catalog_sub("amazon", "usa-ecode", rate="0.85")

    def submit(self, code=None, face="100", user=None, subcategory=None, **extra):
        self.client.force_authenticate(user or self.seller)
        code = code or f"CARD-{next(_n):06d}-XYZ"
        sub = subcategory or self.amazon
        return self.client.post(
            "/api/giftcards/", {"subcategory": str(sub.pk), "card_code": code, "face_value": face, **extra}, format="json"
        )

    def sub(self, r):
        return GiftCardSubmission.objects.get(pk=r.json()["id"])

    def approve(self, submission, value="100", confirmed=True, **kw):
        self.client.force_authenticate(self.admin)
        body = {"decision": "approve", "redeemed_confirmed": confirmed, "redeemed_value": value, **kw}
        return self.client.post(f"/api/admin/giftcards/{submission.pk}/review/", body, format="json")

    def auto_on(self, payout_max=None):
        ps = PaymentSettings.get()
        ps.giftcard_auto_payment_enabled = True
        if payout_max is not None:
            ps.giftcard_auto_payout_max_ghs = Decimal(payout_max)
        ps.save()


class SubmissionHardeningTests(Base):
    """Each of these was a real, demonstrated hole before the payments work."""

    def test_the_seller_cannot_choose_the_payout_rate(self):
        r = self.submit(offered_rate="5.0")
        self.assertEqual(r.status_code, 201)
        s = self.sub(r)
        self.assertEqual(s.offered_rate, Decimal("0.85"))
        self.assertEqual(s.transaction.amount, Decimal("85.00"))  # not 500

    def test_the_rate_comes_from_the_subcategory(self):
        catalog_sub("amazon", "usa-ecode", rate="0.80")
        self.assertEqual(self.sub(self.submit()).transaction.amount, Decimal("80.00"))

    def test_the_same_card_in_different_spellings_is_a_duplicate(self):
        self.assertEqual(self.submit("ABCD-1234-EFGH").status_code, 201)
        for again in ["abcd-1234-efgh", "ABCD1234EFGH", "ABCD 1234 EFGH", " abcd_1234.efgh "]:
            self.assertEqual(self.submit(again).status_code, 400, again)

    def test_a_card_stored_under_the_old_hashing_scheme_is_still_caught(self):
        import hashlib
        legacy = hashlib.sha256(b"OLD-CARD-99").hexdigest()
        s = self.sub(self.submit("SOMETHING-ELSE-1"))
        GiftCardSubmission.objects.filter(pk=s.pk).update(card_code_hash=legacy)
        self.assertEqual(self.submit("OLD-CARD-99").status_code, 400)

    def test_face_value_must_be_positive(self):
        self.assertEqual(self.submit(face="0").status_code, 400)
        self.assertEqual(self.submit(face="-5").status_code, 400)


class ApprovalTests(Base):
    def test_approval_requires_the_redemption_attestation(self):
        s = self.sub(self.submit())
        self.assertEqual(self.approve(s, confirmed=False).status_code, 400)
        self.assertEqual(self.approve(s, value=None).status_code, 400)
        self.assertEqual(self.approve(s, value="0").status_code, 400)
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "under_review")

    def test_payout_is_computed_from_what_was_actually_redeemed(self):
        s = self.sub(self.submit(face="100"))
        r = self.approve(s, value="20.00", redemption_reference="AMZ-ORDER-77")
        self.assertEqual(r.status_code, 200, r.content)
        s.refresh_from_db(); s.transaction.refresh_from_db()
        self.assertEqual(s.redeemed_value, Decimal("20.00"))
        self.assertEqual(s.verified_value, Decimal("17.00"))          # 20 x 0.85
        self.assertEqual(s.transaction.amount, Decimal("17.00"))      # was left at 85 before
        self.assertEqual(s.redemption_reference, "AMZ-ORDER-77")
        self.assertEqual(s.transaction.status, "verified")

    def test_settling_pays_the_approved_amount_not_the_sellers_estimate(self):
        s = self.sub(self.submit(face="100"))
        self.approve(s, value="20")
        self.client.force_authenticate(self.admin)
        self.client.post(f"/api/admin/transactions/{s.transaction_id}/settle/")
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("17.00"))

    def test_cannot_approve_more_than_the_declared_face_value(self):
        s = self.sub(self.submit(face="100"))
        r = self.approve(s, value="1000")  # a typo that would pay 10x
        self.assertEqual(r.status_code, 400)
        self.assertEqual(wallet_of(self.seller, "GHS").balance, 0)

    def test_payout_rounds_down_never_up(self):
        s = self.sub(self.submit(face="33.33"))
        self.approve(s, value="33.33")
        s.refresh_from_db()
        self.assertEqual(s.verified_value, Decimal("28.33"))  # 28.3305

    def test_approving_twice_pays_once(self):
        self.auto_on()
        s = self.sub(self.submit())
        self.assertEqual(self.approve(s).status_code, 200)
        self.assertEqual(self.approve(s).status_code, 400)
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("85.00"))

    def test_reject_and_flag_still_work_and_cannot_be_repeated(self):
        a, b = self.sub(self.submit()), self.sub(self.submit())
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"/api/admin/giftcards/{a.pk}/review/", {"decision": "reject"}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/admin/giftcards/{a.pk}/review/", {"decision": "approve", "redeemed_confirmed": True, "redeemed_value": "100"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/admin/giftcards/{b.pk}/review/", {"decision": "flag", "reviewer_notes": "odd"}, format="json").status_code, 200)
        self.assertTrue(ComplianceFlag.objects.filter(transaction=b.transaction).exists())

    def test_approval_is_written_to_the_audit_log(self):
        s = self.sub(self.submit())
        self.approve(s)
        log = AuditLog.objects.get(action="giftcard_approved")
        self.assertEqual((log.actor, log.target_id), (self.admin, str(s.pk)))

    def test_non_staff_cannot_review(self):
        s = self.sub(self.submit())
        self.client.force_authenticate(self.seller)
        r = self.client.post(f"/api/admin/giftcards/{s.pk}/review/", {"decision": "approve", "redeemed_confirmed": True, "redeemed_value": "100"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_the_generic_transaction_endpoint_cannot_bypass_the_attestation(self):
        s = self.sub(self.submit())
        self.client.force_authenticate(self.admin)
        r = self.client.post(f"/api/admin/transactions/{s.transaction_id}/transition/", {"status": "verified"}, format="json")
        self.assertEqual(r.status_code, 400)
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "under_review")

    def test_django_admin_has_no_bulk_approve(self):
        model_admin = django_admin.site._registry[GiftCardSubmission]
        self.assertNotIn("approve_cards", model_admin.actions)


class AutoPaymentTests(Base):
    """Auto-payment: OFF by default; two independent layers when ON."""

    def test_default_is_off_and_approval_pays_nothing_by_itself(self):
        s = self.sub(self.submit())
        self.approve(s)
        self.assertEqual(wallet_of(self.seller, "GHS").balance, 0)
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "verified")
        self.assertFalse(s.transaction.metadata["auto_payment"]["auto_settled"])

    def test_when_on_approval_credits_the_wallet_immediately(self):
        self.auto_on()
        s = self.sub(self.submit())
        r = self.approve(s)
        self.assertEqual(r.json()["auto_payment"]["auto_settled"], True)
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("85.00"))
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "settled")
        self.assertTrue(Notification.objects.filter(user=self.seller, title="Payment received").exists())

    def opt_in(self, user=None, age=timedelta(days=2)):
        user = user or self.seller
        dest = payments.add_destination(user=user, network="mtn", account_number="0244123456", account_name="Sam Seller")
        type(dest).objects.filter(pk=dest.pk).update(created_at=timezone.now() - age)
        payments.set_auto_payout(user=user, enabled=True, destination_id=dest.pk)
        return dest

    @STUB
    def test_opted_in_seller_within_the_cap_is_paid_out_automatically(self):
        self.auto_on(payout_max="500")
        self.opt_in()
        s = self.sub(self.submit())
        with self.captureOnCommitCallbacks(execute=True):
            r = self.approve(s)
        ap = r.json()["auto_payment"]["auto_payout"]
        self.assertEqual(ap["status"], "sent")
        payout = Transaction.objects.get(pk=ap["transaction"])
        self.assertEqual((payout.transaction_type, payout.status, payout.amount), ("fiat_payout", "settled", Decimal("85.00")))
        self.assertEqual(payout.metadata["source"], "giftcard_auto")
        w = wallet_of(self.seller, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (0, 0))  # credited then sent on

    def assert_stays_in_wallet(self, reason_fragment):
        s = self.sub(self.submit())
        with self.captureOnCommitCallbacks(execute=True):
            r = self.approve(s)
        ap = r.json()["auto_payment"]["auto_payout"]
        self.assertEqual(ap["status"], "skipped", ap)
        self.assertIn(reason_fragment, ap["reason"])
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("85.00"))  # credit stands
        return ap

    @STUB
    def test_not_opted_in_means_no_payout_and_no_noise(self):
        self.auto_on(payout_max="500")
        self.assert_stays_in_wallet("not opted in")
        self.assertFalse(Notification.objects.filter(user=self.seller, title="Your earnings are in your wallet").exists())

    @STUB
    def test_no_payout_cap_configured_means_never_auto_send(self):
        self.auto_on()  # max stays 0
        self.opt_in()
        self.assert_stays_in_wallet("above the automatic payout limit")
        self.assertTrue(Notification.objects.filter(user=self.seller, title="Your earnings are in your wallet").exists())

    @STUB
    def test_amounts_over_the_cap_stay_in_the_wallet(self):
        self.auto_on(payout_max="50")
        self.opt_in()
        self.assert_stays_in_wallet("above the automatic payout limit")

    @STUB
    def test_a_newly_added_payout_account_has_a_cooling_off_period(self):
        self.auto_on(payout_max="500")
        self.opt_in(age=timedelta(minutes=5))
        self.assert_stays_in_wallet("added recently")

    @STUB
    def test_flagged_or_open_compliance_case_blocks_auto_send(self):
        self.auto_on(payout_max="500")
        self.opt_in()
        ComplianceFlag.objects.create(user=self.seller, reason="velocity")
        self.assert_stays_in_wallet("quick review")

    @STUB
    def test_daily_limit_still_applies_to_auto_payouts(self):
        basic = make_user("basicseller", tier="basic")
        self.seller = basic
        self.auto_on(payout_max="5000")
        self.opt_in(basic)
        s = self.sub(self.submit(face="3000", user=basic))
        with self.captureOnCommitCallbacks(execute=True):
            r = self.approve(s, value="3000")
        # 2,550 payout > 2,000 basic limit: wallet credited, not sent
        self.assertEqual(r.json()["auto_payment"]["auto_payout"]["status"], "skipped")
        self.assertEqual(wallet_of(basic, "GHS").balance, Decimal("2550.00"))

    @STUB
    def test_a_failing_payout_provider_returns_the_money_to_the_wallet(self):
        self.auto_on(payout_max="500")
        self.opt_in()
        s = self.sub(self.submit())
        with mock.patch("apps.payments.providers.StubPaymentProvider.send_fiat_payout",
                        return_value=ProviderResult("failed", message="Number not registered")):
            with self.captureOnCommitCallbacks(execute=True):
                self.approve(s)
        w = wallet_of(self.seller, "GHS")
        self.assertEqual((w.balance, w.escrow_balance), (Decimal("85.00"), 0))
        payout = Transaction.objects.get(transaction_type="fiat_payout")
        self.assertEqual(payout.status, "rejected")

    @STUB
    def test_a_crash_in_the_payout_step_can_never_undo_the_credit(self):
        self.auto_on(payout_max="500")
        self.opt_in()
        s = self.sub(self.submit())
        with mock.patch("apps.payments.services.request_withdrawal", side_effect=RuntimeError("bug")):
            r = self.approve(s)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["auto_payment"]["auto_payout"]["status"], "skipped")
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("85.00"))
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "settled")

    @STUB
    def test_payout_goes_to_the_saved_account_even_if_someone_later_changes_it(self):
        self.auto_on(payout_max="500")
        d = self.opt_in()
        s = self.sub(self.submit())
        with self.captureOnCommitCallbacks(execute=True):
            self.approve(s)
        p = Transaction.objects.get(transaction_type="fiat_payout")
        self.assertEqual(p.metadata["destination"]["account_number"], d.account_number)  # snapshot kept on the record

    def test_money_is_conserved_end_to_end(self):
        from apps.payments.testing import total_money
        self.auto_on()
        s = self.sub(self.submit())
        self.approve(s)
        self.assertEqual(total_money("GHS"), Decimal("85.00"))



class CatalogTests(Base):
    """The catalog the sell screen is built from."""

    def get_catalog(self):
        self.client.force_authenticate(self.seller)
        r = self.client.get("/api/giftcards/catalog/")
        self.assertEqual(r.status_code, 200)
        return {b["slug"]: b for b in r.json()["brands"]}

    def test_catalog_has_the_researched_brands_each_with_subcategories(self):
        cat = self.get_catalog()
        for slug in ["amazon", "apple", "google_play", "steam", "playstation", "xbox", "razer_gold", "walmart", "target",
                     "ebay", "nike", "sephora", "nordstrom", "vanilla", "visa", "amex", "roblox", "best_buy", "macys"]:
            self.assertIn(slug, cat)
            self.assertGreater(len(cat[slug]["subcategories"]), 0, slug)
        self.assertGreaterEqual(len(cat), 40)

    def test_popular_brands_come_first(self):
        order = list(self.get_catalog())
        self.assertEqual(order[:4], ["amazon", "apple", "google_play", "steam"])

    def test_subcategory_carries_country_currency_and_format(self):
        cat = self.get_catalog()
        apple = {s["slug"]: s for s in cat["apple"]["subcategories"]}
        self.assertEqual(apple["usa-ecode"]["currency"], "USD")
        self.assertEqual(apple["uk-physical"]["currency"], "GBP")
        self.assertEqual(apple["switzerland"]["currency"], "CHF")
        self.assertEqual(apple["usa-physical-horizontal"]["card_format"], "physical")
        # Exchanges price a physical card layout and a code-only submission differently.
        self.assertIn("usa-physical-vertical", apple)
        self.assertIn("usa-code-only", apple)

    def test_steam_is_split_by_currency(self):
        steam = {s["slug"]: s["currency"] for s in self.get_catalog()["steam"]["subcategories"]}
        self.assertEqual({steam["usa-ecode"], steam["uk"], steam["europe"], steam["canada"], steam["australia"]},
                         {"USD", "GBP", "EUR", "CAD", "AUD"})

    def test_unpriced_subcategories_are_listed_but_unavailable(self):
        cat = self.get_catalog()
        subs = {s["slug"]: s for s in cat["amazon"]["subcategories"]}
        self.assertTrue(subs["usa-ecode"]["available"])
        self.assertEqual(subs["usa-ecode"]["rate"], "0.850000")
        self.assertFalse(subs["uk-ecode"]["available"])
        self.assertIsNone(subs["uk-ecode"]["rate"])

    def test_inactive_brands_and_subcategories_are_hidden(self):
        catalog_sub("amazon", "usa-physical", is_active=False)
        GiftCardBrand.objects.filter(slug="nike").update(is_active=False)
        cat = self.get_catalog()
        self.assertNotIn("usa-physical", [s["slug"] for s in cat["amazon"]["subcategories"]])
        self.assertNotIn("nike", cat)

    def test_a_brand_with_nothing_sellable_gets_no_tile(self):
        GiftCardSubcategory.objects.filter(brand__slug="adidas").update(is_active=False)
        self.assertNotIn("adidas", self.get_catalog())

    def test_catalog_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/giftcards/catalog/").status_code, 401)

    def test_admin_added_brand_appears_without_any_code_change(self):
        b = GiftCardBrand.objects.create(slug="lowes", name="Lowe's", category="shopping")
        GiftCardSubcategory.objects.create(brand=b, slug="usa", name="USA", country="US", currency="USD", rate=Decimal("9"))
        self.assertIn("lowes", self.get_catalog())


class SubcategorySellingTests(Base):
    """Selecting a subcategory decides brand, currency, rate and allowed value."""

    def test_brand_currency_and_rate_come_from_the_subcategory_not_the_client(self):
        uk = catalog_sub("amazon", "uk-ecode", rate="15.5")
        r = self.submit(subcategory=uk, face="20", brand="steam", card_currency="JPY", offered_rate="99")
        self.assertEqual(r.status_code, 201, r.content)
        s = self.sub(r)
        self.assertEqual((s.brand, s.card_currency, s.offered_rate, s.subcategory), ("amazon", "GBP", Decimal("15.5"), uk))
        self.assertEqual(s.transaction.amount, Decimal("310.00"))  # 20 GBP x 15.5
        body = r.json()
        self.assertEqual((body["brand_name"], body["subcategory_name"], body["estimated_payout"]), ("Amazon", "UK · E-code", "310.00"))

    def test_the_same_brand_pays_differently_per_subcategory(self):
        usd = catalog_sub("apple", "usa-physical-horizontal", rate="12.0")
        ecode = catalog_sub("apple", "usa-ecode", rate="10.4")
        a = self.sub(self.submit(subcategory=usd, face="100"))
        b = self.sub(self.submit(subcategory=ecode, face="100"))
        self.assertEqual((a.transaction.amount, b.transaction.amount), (Decimal("1200.00"), Decimal("1040.00")))

    def test_a_subcategory_is_required(self):
        self.client.force_authenticate(self.seller)
        r = self.client.post("/api/giftcards/", {"card_code": "AAAA-1111", "face_value": "50"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("subcategory", r.json())

    def test_a_brand_alone_is_no_longer_enough(self):
        self.client.force_authenticate(self.seller)
        r = self.client.post("/api/giftcards/", {"brand": "amazon", "card_code": "AAAA-1111", "face_value": "50"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_an_unpriced_subcategory_cannot_be_sold(self):
        r = self.submit(subcategory=GiftCardSubcategory.objects.get(brand__slug="amazon", slug="uk-ecode"))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(GiftCardSubmission.objects.exists())

    def test_inactive_subcategory_or_brand_cannot_be_sold(self):
        sub = catalog_sub("amazon", "usa-ecode", is_active=False)
        self.assertEqual(self.submit(subcategory=sub).status_code, 400)
        catalog_sub("amazon", "usa-ecode", is_active=True)
        GiftCardBrand.objects.filter(slug="amazon").update(is_active=False)
        self.assertEqual(self.submit().status_code, 400)

    def test_an_unknown_subcategory_id_is_rejected(self):
        self.client.force_authenticate(self.seller)
        r = self.client.post("/api/giftcards/", {"subcategory": "00000000-0000-0000-0000-000000000000", "card_code": "AAAA-1111", "face_value": "50"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_value_bands_are_enforced(self):
        band = catalog_sub("vanilla", "usa-100-299", rate="9")
        self.assertEqual(self.submit(subcategory=band, face="50").status_code, 400)
        self.assertEqual(self.submit(subcategory=band, face="300").status_code, 400)
        self.assertEqual(self.submit(subcategory=band, face="150").status_code, 201)
        self.assertIn("minimum", self.submit(subcategory=band, face="99").json()["face_value"][0])

    def test_the_locked_rate_survives_a_later_rate_change(self):
        s = self.sub(self.submit(face="100"))
        catalog_sub("amazon", "usa-ecode", rate="5.0")  # the market moves while the card waits
        self.approve(s, value="100")
        s.refresh_from_db()
        self.assertEqual(s.verified_value, Decimal("85.00"))  # still what the seller was promised

    def test_rate_updated_at_tracks_rate_changes_only(self):
        sub = catalog_sub("amazon", "usa-ecode")
        first = sub.rate_updated_at
        self.assertIsNotNone(first)
        sub.name = "USA · E-code (renamed)"
        sub.save()
        sub.refresh_from_db()
        self.assertEqual(sub.rate_updated_at, first)
        sub.rate = Decimal("0.9")
        sub.save()
        sub.refresh_from_db()
        self.assertGreater(sub.rate_updated_at, first)

    def test_history_lists_show_brand_and_subcategory_names(self):
        self.submit()
        self.client.force_authenticate(self.seller)
        row = self.client.get("/api/giftcards/").json()[0]
        self.assertEqual((row["brand_name"], row["subcategory_name"], row["card_currency"]), ("Amazon", "USA · E-code", "USD"))

    def test_admin_sees_what_kind_of_card_to_redeem(self):
        s = self.sub(self.submit())
        self.client.force_authenticate(self.admin)
        row = self.client.get(f"/api/admin/giftcards/{s.pk}/").json()
        self.assertEqual((row["brand_name"], row["subcategory_name"], row["country"], row["card_format"], row["card_currency"]),
                         ("Amazon", "USA · E-code", "US", "ecode", "USD"))

    def test_legacy_submissions_without_a_subcategory_still_display(self):
        s = self.sub(self.submit())
        GiftCardSubmission.objects.filter(pk=s.pk).update(subcategory=None, brand="razer_gold")
        self.client.force_authenticate(self.seller)
        row = self.client.get("/api/giftcards/").json()[0]
        self.assertEqual((row["brand_name"], row["subcategory_name"]), ("Razer Gold", None))


class HighRiskCardTests(Base):
    """Open-loop prepaid cards are never auto-paid, even with auto-payment switched on."""

    def setUp(self):
        super().setUp()
        self.auto_on = PaymentSettings.get()
        self.auto_on.giftcard_auto_payment_enabled = True
        self.auto_on.save()

    def test_prepaid_visa_is_manual_only_even_with_auto_payment_on(self):
        visa = catalog_sub("visa", "usa-no-receipt", rate="9")
        s = self.sub(self.submit(subcategory=visa, face="100"))
        r = self.approve(s, value="100")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body["auto_payment"]["auto_settled"])
        self.assertIn("manual settlement", body["auto_payment"]["manual_reason"])
        s.transaction.refresh_from_db()
        self.assertEqual(s.transaction.status, "verified")           # approved, but NOT paid
        self.assertEqual(wallet_of(self.seller, "GHS").balance, 0)
        self.client.force_authenticate(self.admin)
        self.client.post(f"/api/admin/transactions/{s.transaction_id}/settle/")  # a human pays it
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("900.00"))

    def test_a_normal_card_is_still_auto_paid_in_the_same_conditions(self):
        r = self.approve(self.sub(self.submit()), value="100")
        self.assertTrue(r.json()["auto_payment"]["auto_settled"])
        self.assertEqual(wallet_of(self.seller, "GHS").balance, Decimal("85.00"))

    def test_legacy_submissions_without_a_subcategory_are_manual_only(self):
        s = self.sub(self.submit())
        GiftCardSubmission.objects.filter(pk=s.pk).update(subcategory=None)
        r = self.approve(s, value="100")
        self.assertFalse(r.json()["auto_payment"]["auto_settled"])
        self.assertEqual(wallet_of(self.seller, "GHS").balance, 0)

    def test_every_open_loop_prepaid_subcategory_is_flagged_manual(self):
        subs = GiftCardSubcategory.objects.filter(brand__category="prepaid")
        self.assertGreater(subs.count(), 10)
        self.assertFalse(subs.filter(allow_auto_payment=True).exists())


class CatalogDataTests(APITestCase):
    """Sanity checks on the seed data itself, so a typo in catalog_data.py can't ship."""

    def test_catalog_data_is_well_formed(self):
        from .catalog_data import CATALOG

        cats = {c for c, _ in GiftCardBrand.Category.choices}
        formats = {f for f, _ in GiftCardSubcategory.Format.choices}
        seen_brands = set()
        for b in CATALOG:
            self.assertNotIn(b["slug"], seen_brands, f"duplicate brand {b['slug']}")
            seen_brands.add(b["slug"])
            self.assertIn(b["category"], cats, b["slug"])
            self.assertTrue(b["subs"], b["slug"])
            slugs = [s["slug"] for s in b["subs"]]
            self.assertEqual(len(slugs), len(set(slugs)), f"duplicate subcategory slug in {b['slug']}: {slugs}")
            for s in b["subs"]:
                self.assertRegex(s["currency"], r"^[A-Z]{3}$", (b["slug"], s["slug"]))
                self.assertIn(s["card_format"], formats)
                if s["min_value"] is not None and s["max_value"] is not None:
                    self.assertLess(s["min_value"], s["max_value"])
            if b["category"] == "prepaid":
                self.assertTrue(all(not s["allow_auto_payment"] for s in b["subs"]), b["slug"])

    def test_seeded_catalog_matches_the_data(self):
        from .catalog_data import CATALOG

        self.assertEqual(GiftCardBrand.objects.count(), len(CATALOG))
        self.assertEqual(GiftCardSubcategory.objects.count(), sum(len(b["subs"]) for b in CATALOG))

    def test_no_rate_is_ever_seeded(self):
        self.assertFalse(GiftCardSubcategory.objects.exclude(rate=None).exists())

    def test_sync_only_creates_what_is_missing_and_never_overwrites_edits(self):
        from .catalog_data import sync_catalog

        sub = catalog_sub("amazon", "usa-ecode", rate="12.5", name="My custom name", is_active=False)
        removed = GiftCardSubcategory.objects.get(brand__slug="amazon", slug="canada")
        removed.delete()
        result = sync_catalog(GiftCardBrand, GiftCardSubcategory)
        self.assertEqual(result, {"brands": 0, "subcategories": 1})  # only the deleted one comes back
        sub.refresh_from_db()
        self.assertEqual((sub.rate, sub.name, sub.is_active), (Decimal("12.5"), "My custom name", False))

    def test_set_rates_command_fills_only_unpriced_by_default(self):
        from io import StringIO

        from django.core.management import call_command

        catalog_sub("apple", "usa-ecode", rate="10.0")
        call_command("set_giftcard_rates", "--currency", "USD", "--rate", "12", stdout=StringIO())
        self.assertEqual(GiftCardSubcategory.objects.get(brand__slug="apple", slug="usa-ecode").rate, Decimal("10.0"))
        self.assertEqual(GiftCardSubcategory.objects.get(brand__slug="amazon", slug="usa-ecode").rate, Decimal("12"))
        self.assertFalse(GiftCardSubcategory.objects.filter(currency="USD", rate=None).exists())
        self.assertTrue(GiftCardSubcategory.objects.filter(currency="GBP", rate=None).exists())  # untouched

    def test_set_rates_command_needs_a_filter_and_supports_dry_run_and_overwrite(self):
        from io import StringIO

        from django.core.management import CommandError, call_command

        with self.assertRaises(CommandError):
            call_command("set_giftcard_rates", "--rate", "5", stdout=StringIO())
        call_command("set_giftcard_rates", "--brand", "steam", "--rate", "11", "--dry-run", stdout=StringIO())
        self.assertFalse(GiftCardSubcategory.objects.filter(brand__slug="steam").exclude(rate=None).exists())
        call_command("set_giftcard_rates", "--brand", "steam", "--format", "ecode", "--rate", "11", stdout=StringIO())
        call_command("set_giftcard_rates", "--brand", "steam", "--format", "ecode", "--rate", "13", "--overwrite", stdout=StringIO())
        self.assertEqual(GiftCardSubcategory.objects.get(brand__slug="steam", slug="usa-ecode").rate, Decimal("13"))


class ImageAccessTests(Base):
    """
    GiftCardImageView / GiftCardGalleryImageView — added alongside the
    audit fix for card photos and evidence being reachable by anyone with
    the URL. Mirrors the scenarios checked by hand during that fix.
    """

    def _real_png(self):
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (2, 2), color=(1, 2, 3)).save(buf, format="PNG")
        return buf.getvalue()

    def _submit_with_images(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = self._real_png()
        self.client.force_authenticate(self.seller)
        r = self.client.post(
            "/api/giftcards/",
            {
                "subcategory": str(self.amazon.pk),
                "card_code": f"CARD-{next(_n):06d}-IMG",
                "face_value": "100",
                "card_image": SimpleUploadedFile("card.png", png, content_type="image/png"),
                "images": [SimpleUploadedFile("evidence.png", png, content_type="image/png")],
            },
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_card_image_url_is_authenticated_not_raw_media(self):
        data = self._submit_with_images()
        self.assertNotIn("/media/", data["card_image"])
        self.assertIn("/card-image/", data["card_image"])

    def test_owner_can_view_their_card_image(self):
        data = self._submit_with_images()
        path = data["card_image"].split("testserver")[-1]
        self.client.force_authenticate(self.seller)
        r = self.client.get(path)
        self.assertEqual(r.status_code, 200)
        content = b"".join(r.streaming_content) if r.streaming else r.content
        self.assertEqual(content, self._real_png())

    def test_a_different_seller_cannot_view_it(self):
        data = self._submit_with_images()
        path = data["card_image"].split("testserver")[-1]
        other = make_user("other_seller")
        self.client.force_authenticate(other)
        r = self.client.get(path)
        self.assertEqual(r.status_code, 403)

    def test_staff_can_view_it(self):
        data = self._submit_with_images()
        path = data["card_image"].split("testserver")[-1]
        self.client.force_authenticate(self.admin)
        r = self.client.get(path)
        self.assertEqual(r.status_code, 200)

    def test_gallery_item_has_the_same_access_rule(self):
        data = self._submit_with_images()
        gallery_path = data["gallery"][0]["url"].split("testserver")[-1]

        other = make_user("gallery_stranger")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(gallery_path).status_code, 403)

        self.client.force_authenticate(self.seller)
        self.assertEqual(self.client.get(gallery_path).status_code, 200)

    def test_disallowed_file_type_in_evidence_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.seller)
        r = self.client.post(
            "/api/giftcards/",
            {
                "subcategory": str(self.amazon.pk),
                "card_code": f"CARD-{next(_n):06d}-BAD",
                "face_value": "100",
                "images": [SimpleUploadedFile("evidence.exe", b"MZ" + b"A" * 100, content_type="application/x-msdownload")],
            },
            format="multipart",
        )
        self.assertEqual(r.status_code, 400)
