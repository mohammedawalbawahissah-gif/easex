import hashlib
import json
from datetime import timedelta
from unittest import mock

from django.contrib import admin as django_admin
from django.core.cache import cache
from django.utils import timezone

from apps.compliance.models import AuditLog
from apps.payments.testing import enable_2fa, make_user, totp_code
from apps.security import crypto

from . import services
from .models import GiftCardSubmission
from .tests import Base

RAW = "SECRET-CODE-4711-XYZ"


class CodeStorageTests(Base):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.secret = enable_2fa(self.admin)

    def submit_raw(self, code=RAW):
        return self.sub(self.submit(code=code))

    def reveal(self, s, otp=None, user=None):
        self.client.force_authenticate(user or self.admin)
        return self.client.post(f"/api/admin/giftcards/{s.pk}/reveal-code/", {"otp": otp if otp is not None else totp_code(self.secret)}, format="json")

    # ---- storage ----
    def test_the_code_is_stored_encrypted_not_in_the_clear(self):
        s = self.submit_raw()
        self.assertTrue(s.card_code_encrypted)
        self.assertNotIn("SECRET", s.card_code_encrypted)
        self.assertEqual(crypto.decrypt(s.card_code_encrypted), RAW)

    def test_no_api_ever_returns_the_code_or_the_ciphertext(self):
        r = self.submit(code=RAW)
        s = GiftCardSubmission.objects.get(pk=r.json()["id"])
        blobs = [r.content.decode()]
        self.client.force_authenticate(self.seller)
        blobs += [self.client.get("/api/giftcards/").content.decode(), self.client.get(f"/api/giftcards/{s.pk}/").content.decode()]
        self.client.force_authenticate(self.admin)
        blobs += [self.client.get("/api/admin/giftcards/").content.decode(), self.client.get(f"/api/admin/giftcards/{s.pk}/").content.decode()]
        for blob in blobs:
            self.assertNotIn("SECRET-CODE", blob)
            self.assertNotIn("SECRETCODE", blob)
            self.assertNotIn(s.card_code_encrypted, blob)
            self.assertNotIn("card_code_encrypted", blob)
            self.assertNotIn(s.card_code_hash, blob)
        admin_row = json.loads(blobs[-1])
        self.assertTrue(admin_row["code_available"])  # tells staff a reveal is possible, without the code

    def test_django_admin_cannot_display_the_ciphertext(self):
        self.assertIn("card_code_encrypted", django_admin.site._registry[GiftCardSubmission].exclude)

    def test_fingerprint_is_keyed_so_it_is_not_a_plain_hash_of_the_code(self):
        s = self.submit_raw()
        plain = hashlib.sha256(services.normalize_card_code(RAW).encode()).hexdigest()
        self.assertNotEqual(s.card_code_hash, plain)
        self.assertRegex(s.card_code_hash, r"^[0-9a-f]{64}$")
        with self.settings(GIFTCARD_FINGERPRINT_KEY="a-different-key"):
            self.assertNotEqual(services.card_code_hashes(RAW)[0], s.card_code_hash)

    def test_duplicates_are_caught_across_every_fingerprint_scheme(self):
        s = self.submit_raw("DUPE-1111-AAAA")
        self.assertEqual(self.submit(code="dupe 1111 aaaa").status_code, 400)  # current keyed scheme
        older = hashlib.sha256(services.normalize_card_code("OLDER-2222-BBBB").encode()).hexdigest()  # last week's scheme
        GiftCardSubmission.objects.filter(pk=s.pk).update(card_code_hash=older)
        self.assertEqual(self.submit(code="older-2222-bbbb").status_code, 400)

    # ---- reveal ----
    def test_a_reviewer_with_a_fresh_2fa_code_can_reveal_and_it_is_audited(self):
        s = self.submit_raw()
        r = self.reveal(s)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["code"], RAW)
        self.assertEqual(r["Cache-Control"], "no-store")
        log = AuditLog.objects.get(action="giftcard_code_revealed")
        self.assertEqual((log.actor, log.target_id, log.details["reveal_number"]), (self.admin, str(s.pk), 1))
        s.refresh_from_db()
        self.assertEqual(s.code_reveal_count, 1)

    def test_a_wrong_2fa_code_reveals_nothing_and_leaves_no_audit_entry(self):
        s = self.submit_raw()
        r = self.reveal(s, otp="000000")
        self.assertEqual((r.status_code, r.json()["code"]), (400, "bad_otp"))
        self.assertNotIn(RAW, r.content.decode())
        self.assertFalse(AuditLog.objects.filter(action="giftcard_code_revealed").exists())

    def test_a_2fa_code_cannot_be_reused_to_reveal_a_second_card(self):
        a, b = self.submit_raw("CARD-A-0001"), self.submit_raw("CARD-B-0002")
        code = totp_code(self.secret)
        self.assertEqual(self.reveal(a, otp=code).status_code, 200)
        self.assertEqual(self.reveal(b, otp=code).json()["code"], "bad_otp")  # same code, already spent

    def test_a_reviewer_without_2fa_cannot_reveal_even_if_the_staff_setting_is_off(self):
        s = self.submit_raw()
        other = make_user("staff2", staff=True)  # no 2FA
        r = self.reveal(s, otp="123456", user=other)
        self.assertEqual((r.status_code, r.json()["code"]), (400, "bad_otp"))

    def test_only_staff_can_reveal(self):
        s = self.submit_raw()
        self.assertEqual(self.reveal(s, user=self.seller).status_code, 403)
        self.assertEqual(self.reveal(s, user=make_user("rando")).status_code, 403)

    def test_guessing_2fa_codes_to_reveal_is_locked_out(self):
        s = self.submit_raw()
        for _ in range(5):
            self.reveal(s, otp="000000")
        r = self.reveal(s)  # even the right code, now
        self.assertEqual((r.status_code, r.json()["code"]), (429, "locked"))

    def test_reveals_are_rate_limited_per_reviewer(self):
        s = self.submit_raw()
        with mock.patch.object(services, "REVEALS_PER_HOUR", 2), mock.patch("apps.security.services.verify_totp"):
            codes = [self.reveal(s, otp="111111").status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 400])
        self.assertEqual(AuditLog.objects.filter(action="giftcard_code_revealed").count(), 2)

    # ---- erasure ----
    def test_approving_erases_the_code_for_good(self):
        s = self.submit_raw()
        self.approve(s, value="100")
        s.refresh_from_db()
        self.assertEqual(s.card_code_encrypted, "")
        self.assertIsNotNone(s.code_wiped_at)
        r = self.reveal(s)
        self.assertEqual(r.status_code, 400)
        self.assertIn("erased", r.json()[0])

    def test_rejecting_erases_the_code_too(self):
        s = self.submit_raw()
        self.client.force_authenticate(self.admin)
        self.client.post(f"/api/admin/giftcards/{s.pk}/review/", {"decision": "reject"}, format="json")
        s.refresh_from_db()
        self.assertEqual(s.card_code_encrypted, "")

    def test_a_flagged_card_keeps_its_code_for_the_investigation(self):
        s = self.submit_raw()
        self.client.force_authenticate(self.admin)
        self.client.post(f"/api/admin/giftcards/{s.pk}/review/", {"decision": "flag"}, format="json")
        s.refresh_from_db()
        self.assertTrue(s.card_code_encrypted)
        self.assertEqual(self.reveal(s).json()["code"], RAW)

    def test_cards_from_before_code_storage_say_so_clearly(self):
        s = self.submit_raw()
        GiftCardSubmission.objects.filter(pk=s.pk).update(card_code_encrypted="")
        r = self.reveal(s)
        self.assertEqual(r.status_code, 400)
        self.assertIn("No code is stored", r.json()[0])

    def test_old_unreviewed_codes_are_swept_away(self):
        old, fresh = self.submit_raw("OLD-CARD-0001"), self.submit_raw("NEW-CARD-0002")
        GiftCardSubmission.objects.filter(pk=old.pk).update(submitted_at=timezone.now() - timedelta(days=31))
        self.assertEqual(services.wipe_stale_codes(), 1)
        old.refresh_from_db(); fresh.refresh_from_db()
        self.assertEqual(old.card_code_encrypted, "")
        self.assertTrue(fresh.card_code_encrypted)

    def test_the_sweep_is_registered_with_the_scheduler(self):
        from django.conf import settings

        self.assertIn("wipe-stale-gift-card-codes", settings.CELERY_BEAT_SCHEDULE)
        from .tasks import wipe_stale_codes

        self.assertEqual(wipe_stale_codes(), 0)
