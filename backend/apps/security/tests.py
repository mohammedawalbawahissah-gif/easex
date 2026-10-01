import time
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient, APITestCase

from apps.compliance.models import AuditLog
from apps.notifications.models import Notification
from apps.payments import services as payments
from apps.payments.testing import PASSWORD, PIN, enable_2fa, fund, make_user, totp_code, wallet_of

from . import crypto, lockout, services
from .models import RecoveryCode, SecurityProfile
from .views import MFA_SALT

NEW_PIN = "739104"


class Base(APITestCase):
    def setUp(self):
        cache.clear()  # lockout / throttle counters live in the cache
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def api(self, user=None):
        c = APIClient()
        if user:
            c.force_authenticate(user)
        return c

    def post(self, path, data, user=None):
        return self.api(user).post(path, data, format="json")

    def login(self, username="alice", password=PASSWORD):
        return APIClient().post("/api/auth/login/", {"username": username, "password": password}, format="json")

    def send(self, user=None, pin=PIN, **extra):
        return self.post("/api/payments/transfers/", {
            "recipient": "bob", "currency": "GHS", "amount": "5", "pin": pin,
            "idempotency_key": f"sec-{time.time_ns()}", **extra}, user or self.alice)


class TransactionPinTests(Base):
    def test_a_user_with_no_pin_cannot_move_money_and_is_told_to_set_one(self):
        u = make_user("nopin", pin=None)
        fund(u, "GHS", 100)
        r = self.send(user=u, pin="")
        self.assertEqual((r.status_code, r.json()["code"]), (400, "pin_not_set"))

    def test_setting_a_pin_requires_the_password(self):
        u = make_user("newbie", pin=None)
        bad = self.post("/api/security/pin/", {"pin": NEW_PIN, "password": "nope"}, u)
        self.assertEqual(bad.json()["code"], "bad_password")
        ok = self.post("/api/security/pin/", {"pin": NEW_PIN, "password": PASSWORD}, u)
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(services.get_profile(u).pin_set)

    def test_weak_pins_are_rejected(self):
        u = make_user("weak", pin=None)
        for weak in ["111111", "000000", "123456", "654321", "234567", "12345", "1234567", "abcdef", ""]:
            r = self.post("/api/security/pin/", {"pin": weak, "password": PASSWORD}, u)
            self.assertEqual(r.status_code, 400, weak)
        self.assertFalse(services.get_profile(u).pin_set)

    def test_first_pin_has_no_cooling_off_but_changing_it_does(self):
        u = make_user("changer", pin=None)
        fund(u, "GHS", 100)
        self.post("/api/security/pin/", {"pin": NEW_PIN, "password": PASSWORD}, u)
        self.assertIsNone(services.cooling_off_until(u))
        self.assertEqual(self.send(user=u, pin=NEW_PIN).status_code, 201)

        self.post("/api/security/pin/", {"pin": "580246", "password": PASSWORD}, u)
        self.assertIsNotNone(services.cooling_off_until(u))
        r = self.send(user=u, pin="580246")
        self.assertEqual((r.status_code, r.json()["code"]), (400, "cooling_off"))
        self.assertTrue(Notification.objects.filter(user=u, title="Transaction PIN changed").exists())

    def test_the_pin_is_never_stored_in_a_recoverable_or_shared_form(self):
        a, b = make_user("p1", pin=None), make_user("p2", pin=None)
        for u in (a, b):
            self.post("/api/security/pin/", {"pin": NEW_PIN, "password": PASSWORD}, u)
        ha, hb = services.get_profile(a).pin_hash, services.get_profile(b).pin_hash
        self.assertNotIn(NEW_PIN, ha)
        self.assertNotEqual(ha, hb)  # same PIN, different users -> different hashes (per-user salt AND pepper)

    def test_five_wrong_pins_lock_money_out_even_for_the_right_pin(self):
        fund(self.alice, "GHS", 100)
        for _ in range(5):
            self.assertEqual(self.send(pin="000999").json()["code"], "bad_pin")
        r = self.send(pin=PIN)  # the CORRECT pin, now refused
        self.assertEqual((r.status_code, r.json()["code"]), (429, "locked"))
        self.assertGreater(r.json()["retry_after"], 0)
        self.assertEqual(wallet_of(self.bob, "GHS").balance, 0)

    def test_a_correct_pin_resets_the_failure_count(self):
        fund(self.alice, "GHS", 100)
        for _ in range(4):
            self.send(pin="000999")
        self.assertEqual(self.send().status_code, 201)
        for _ in range(4):  # a fresh run of 4 wrong guesses is still under the limit
            self.assertEqual(self.send(pin="000999").json()["code"], "bad_pin")
        self.assertEqual(self.send().status_code, 201)

    def test_pin_and_password_guesses_share_one_lockout(self):
        for _ in range(3):
            self.send(pin="000999")
        for _ in range(2):
            self.post("/api/payments/destinations/", {"network": "mtn", "account_number": "0244123456", "account_name": "Ama A", "password": "wrong"}, self.alice)
        self.assertEqual(self.send().json()["code"], "locked")


class LoginLockoutTests(Base):
    def test_five_wrong_passwords_lock_the_username(self):
        for _ in range(5):
            self.assertEqual(self.login(password="wrong").status_code, 401)
        r = self.login()  # correct password, but locked
        self.assertEqual((r.status_code, r.json()["code"]), (429, "locked"))

    def test_locking_does_not_reveal_which_usernames_exist(self):
        for _ in range(5):
            self.login(username="ghost-user", password="x")
        r = self.login(username="ghost-user", password="x")
        self.assertEqual((r.status_code, r.json()["code"]), (429, "locked"))  # identical for a real account

    def test_successful_login_clears_the_counter(self):
        for _ in range(4):
            self.login(password="wrong")
        self.assertEqual(self.login().status_code, 200)
        for _ in range(4):
            self.assertEqual(self.login(password="wrong").status_code, 401)

    def test_login_still_returns_tokens_in_the_familiar_shape(self):
        body = self.login().json()
        self.assertEqual(set(body), {"access", "refresh"})


class SessionRevocationTests(Base):
    def tokens(self):
        return self.login().json()

    def me(self, access):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return c.get("/api/auth/me/")

    def test_changing_the_password_ends_every_other_session(self):
        old = self.tokens()
        self.assertEqual(self.me(old["access"]).status_code, 200)
        time.sleep(1.1)  # JWT `iat` has one-second resolution
        r = self.post("/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "A-brand-new-Pass-77", "confirm_password": "A-brand-new-Pass-77"}, self.alice)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.me(old["access"]).status_code, 401)  # old access token refused
        refresh = APIClient().post("/api/auth/token/refresh/", {"refresh": old["refresh"]}, format="json")
        self.assertEqual(refresh.status_code, 401)  # old refresh token blacklisted
        self.assertEqual(self.me(r.json()["tokens"]["access"]).status_code, 200)  # this device stays signed in

    def test_password_reset_ends_sessions_and_starts_the_cooling_off(self):
        old = self.tokens()
        time.sleep(1.1)
        uid = urlsafe_base64_encode(force_bytes(self.alice.pk))
        token = default_token_generator.make_token(self.alice)
        r = APIClient().post("/api/auth/password-reset-confirm/", {"uid": uid, "token": token, "new_password": "Reset-Pass-8821-x", "confirm_password": "Reset-Pass-8821-x"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.me(old["access"]).status_code, 401)
        self.assertIsNotNone(services.cooling_off_until(self.alice))
        fund(self.alice, "GHS", 50)
        self.assertEqual(self.send().json()["code"], "cooling_off")

    def test_a_reset_does_not_touch_the_pin_or_2fa(self):
        enable_2fa(self.alice)
        uid = urlsafe_base64_encode(force_bytes(self.alice.pk))
        token = default_token_generator.make_token(self.alice)
        APIClient().post("/api/auth/password-reset-confirm/", {"uid": uid, "token": token, "new_password": "Reset-Pass-8821-x", "confirm_password": "Reset-Pass-8821-x"}, format="json")
        profile = services.get_profile(self.alice)
        self.assertTrue(profile.pin_set and profile.totp_enabled)

    def test_new_accounts_and_existing_sessions_are_not_disturbed_by_the_upgrade(self):
        self.assertEqual(self.me(self.tokens()["access"]).status_code, 200)


class TwoFactorTests(Base):
    def setup_2fa(self, user=None):
        user = user or self.alice
        r = self.post("/api/security/2fa/setup/", {"password": PASSWORD}, user)
        self.assertEqual(r.status_code, 200, r.content)
        secret = r.json()["secret"]
        return secret, r.json()

    def enable(self, secret, user=None):
        return self.post("/api/security/2fa/enable/", {"code": totp_code(secret)}, user or self.alice)

    def test_setup_needs_the_password_and_gives_an_authenticator_uri(self):
        bad = self.post("/api/security/2fa/setup/", {"password": "nope"}, self.alice)
        self.assertEqual(bad.json()["code"], "bad_password")
        _, body = self.setup_2fa()
        self.assertTrue(body["otpauth_uri"].startswith("otpauth://totp/"))
        self.assertIn("issuer=EaseX", body["otpauth_uri"])
        self.assertFalse(services.get_profile(self.alice).totp_enabled)  # not on until a code proves it works

    def test_secret_is_encrypted_at_rest(self):
        secret, _ = self.setup_2fa()
        stored = services.get_profile(self.alice).totp_secret_encrypted
        self.assertNotIn(secret, stored)
        self.assertEqual(crypto.decrypt(stored), secret)

    def test_enabling_needs_a_correct_code_and_returns_recovery_codes_once(self):
        secret, _ = self.setup_2fa()
        self.assertEqual(self.post("/api/security/2fa/enable/", {"code": "000000"}, self.alice).json()["code"], "bad_otp")
        r = self.enable(secret)
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(len(body["recovery_codes"]), 10)
        self.assertEqual(len(set(body["recovery_codes"])), 10)
        self.assertIn("access", body["tokens"])
        self.assertTrue(services.get_profile(self.alice).totp_enabled)
        # recovery codes are stored only as keyed digests
        self.assertFalse(RecoveryCode.objects.filter(digest__in=body["recovery_codes"]).exists())
        status = self.api(self.alice).get("/api/security/status/").json()
        self.assertEqual((status["totp_enabled"], status["recovery_codes_remaining"]), (True, 10))

    def test_login_becomes_two_steps(self):
        secret = enable_2fa(self.alice)
        step1 = self.login()
        self.assertEqual(step1.status_code, 200)
        self.assertTrue(step1.json()["mfa_required"])
        self.assertNotIn("access", step1.json())
        step2 = APIClient().post("/api/auth/login/2fa/", {"mfa_token": step1.json()["mfa_token"], "code": totp_code(secret)}, format="json")
        self.assertEqual(step2.status_code, 200, step2.content)
        self.assertIn("access", step2.json())

    def test_a_used_code_cannot_be_replayed(self):
        secret = enable_2fa(self.alice)
        code = totp_code(secret)
        token = self.login().json()["mfa_token"]
        first = APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": code}, format="json")
        again = APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": code}, format="json")
        self.assertEqual((first.status_code, again.status_code), (200, 400))
        self.assertEqual(again.json()["code"], "bad_otp")

    def test_a_wrong_code_or_forged_or_expired_mfa_token_is_refused(self):
        secret = enable_2fa(self.alice)
        token = self.login().json()["mfa_token"]
        self.assertEqual(APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": "123456"}, format="json").status_code, 400)
        forged = signing.dumps({"uid": str(self.bob.pk)}, salt="some-other-salt")
        self.assertEqual(APIClient().post("/api/auth/login/2fa/", {"mfa_token": forged, "code": totp_code(secret)}, format="json").json()["code"], "mfa_expired")
        with mock.patch("django.core.signing.time.time", return_value=time.time() + 600):
            r = APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": totp_code(secret, 1)}, format="json")
        self.assertEqual(r.json()["code"], "mfa_expired")

    def test_a_recovery_code_works_exactly_once(self):
        secret, _ = self.setup_2fa()
        codes = self.enable(secret).json()["recovery_codes"]
        first_login = APIClient().post("/api/auth/login/2fa/", {"mfa_token": self.login().json()["mfa_token"], "code": codes[0]}, format="json")
        second = APIClient().post("/api/auth/login/2fa/", {"mfa_token": self.login().json()["mfa_token"], "code": codes[0]}, format="json")
        self.assertEqual((first_login.status_code, second.status_code), (200, 400))
        self.assertEqual(self.api(self.alice).get("/api/security/status/").json()["recovery_codes_remaining"], 9)

    def test_guessing_codes_locks_2fa(self):
        enable_2fa(self.alice)
        token = self.login().json()["mfa_token"]
        for _ in range(5):
            APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": "000000"}, format="json")
        r = APIClient().post("/api/auth/login/2fa/", {"mfa_token": token, "code": "111111"}, format="json")
        self.assertEqual((r.status_code, r.json()["code"]), (429, "locked"))

    def test_disabling_needs_password_and_a_code_then_starts_the_cooling_off(self):
        secret = enable_2fa(self.alice)
        self.assertEqual(self.post("/api/security/2fa/disable/", {"password": "nope", "code": totp_code(secret)}, self.alice).json()["code"], "bad_password")
        r = self.post("/api/security/2fa/disable/", {"password": PASSWORD, "code": totp_code(secret)}, self.alice)
        self.assertEqual(r.status_code, 200, r.content)
        p = services.get_profile(self.alice)
        self.assertFalse(p.totp_enabled)
        self.assertEqual(p.totp_secret_encrypted, "")
        self.assertIsNotNone(services.cooling_off_until(self.alice))
        self.assertEqual(self.login().json().keys(), {"access", "refresh"})  # back to one-step login
        self.assertTrue(AuditLog.objects.filter(action="2fa_disabled", actor=self.alice).exists())

    def test_recovery_codes_can_be_regenerated_only_with_a_real_authenticator_code(self):
        secret = enable_2fa(self.alice)
        RecoveryCode.objects.create(user=self.alice, digest="x" * 64)
        r = self.post("/api/security/2fa/recovery-codes/", {"password": PASSWORD, "code": totp_code(secret)}, self.alice)
        self.assertEqual(len(r.json()["recovery_codes"]), 10)
        self.assertEqual(RecoveryCode.objects.filter(user=self.alice).count(), 10)  # the old set is gone
        code = r.json()["recovery_codes"][0]
        bad = self.post("/api/security/2fa/recovery-codes/", {"password": PASSWORD, "code": code}, self.alice)
        self.assertEqual(bad.status_code, 400)  # a recovery code can't mint more recovery codes

    def test_with_2fa_on_external_withdrawals_and_account_changes_need_a_code(self):
        secret = enable_2fa(self.alice)
        fund(self.alice, "GHS", 500)
        dest_payload = {"network": "mtn", "account_number": "0244123456", "account_name": "Ama A", "password": PASSWORD}
        self.assertEqual(self.post("/api/payments/destinations/", dest_payload, self.alice).json()["code"], "otp_required")
        added = self.post("/api/payments/destinations/", {**dest_payload, "otp": totp_code(secret)}, self.alice)
        self.assertEqual(added.status_code, 201, added.content)
        dest_id = added.json()["id"]

        wd = {"currency": "GHS", "amount": "50", "destination_id": dest_id, "pin": PIN, "idempotency_key": "wd-2fa-0001"}
        self.assertEqual(self.post("/api/payments/withdraw/", wd, self.alice).json()["code"], "otp_required")
        self.assertEqual(wallet_of(self.alice, "GHS").escrow_balance, 0)
        ok = self.post("/api/payments/withdraw/", {**wd, "otp": totp_code(secret, 1)}, self.alice)
        self.assertEqual(ok.status_code, 201, ok.content)

    def test_internal_transfers_stay_pin_only_even_with_2fa_on(self):
        enable_2fa(self.alice)
        fund(self.alice, "GHS", 50)
        self.assertEqual(self.send().status_code, 201)

    def test_changing_the_pin_with_2fa_on_needs_a_code_too(self):
        secret = enable_2fa(self.alice)
        r = self.post("/api/security/pin/", {"pin": NEW_PIN, "password": PASSWORD}, self.alice)
        self.assertEqual(r.json()["code"], "otp_required")
        ok = self.post("/api/security/pin/", {"pin": NEW_PIN, "password": PASSWORD, "otp": totp_code(secret)}, self.alice)
        self.assertEqual(ok.status_code, 200)


class StaffTwoFactorTests(Base):
    def setUp(self):
        super().setUp()
        self.staff = make_user("boss", staff=True)

    @override_settings(REQUIRE_STAFF_2FA=True)
    def test_staff_without_2fa_are_locked_out_of_admin_tools_with_a_clear_message(self):
        r = self.api(self.staff).get("/api/admin/transactions/")
        self.assertEqual(r.status_code, 403)
        self.assertIn("Two-factor", r.json()["detail"])

    @override_settings(REQUIRE_STAFF_2FA=True)
    def test_staff_with_2fa_get_through_and_ordinary_users_never_do(self):
        enable_2fa(self.staff)
        self.assertEqual(self.api(self.staff).get("/api/admin/transactions/").status_code, 200)
        enable_2fa(self.alice)
        self.assertEqual(self.api(self.alice).get("/api/admin/transactions/").status_code, 403)

    @override_settings(REQUIRE_STAFF_2FA=True)
    def test_every_admin_endpoint_family_is_covered(self):
        for path in ["/api/admin/transactions/", "/api/admin/giftcards/", "/api/admin/dashboard/", "/api/admin/users/", "/api/admin/compliance-flags/"]:
            self.assertEqual(self.api(self.staff).get(path).status_code, 403, path)


class EncryptionTests(APITestCase):
    def test_round_trip_and_ciphertext_differs_each_time(self):
        a, b = crypto.encrypt("ABCD-1234-EFGH"), crypto.encrypt("ABCD-1234-EFGH")
        self.assertNotEqual(a, b)
        self.assertNotIn("ABCD", a)
        self.assertEqual(crypto.decrypt(a), "ABCD-1234-EFGH")

    def test_tampering_is_detected(self):
        token = crypto.encrypt("secret")
        tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        with self.assertRaises(crypto.DecryptionError):
            crypto.decrypt(tampered)

    def test_key_rotation_new_key_encrypts_old_key_still_decrypts(self):
        from cryptography.fernet import Fernet

        old_key = Fernet.generate_key().decode()
        new_key = Fernet.generate_key().decode()
        with override_settings(FIELD_ENCRYPTION_KEYS=[old_key]):
            legacy = crypto.encrypt("rotate-me")
        with override_settings(FIELD_ENCRYPTION_KEYS=[new_key, old_key]):
            self.assertEqual(crypto.decrypt(legacy), "rotate-me")   # old data still readable
            fresh = crypto.encrypt("rotate-me")
        with override_settings(FIELD_ENCRYPTION_KEYS=[new_key]):
            self.assertEqual(crypto.decrypt(fresh), "rotate-me")    # new data needs only the new key
            with self.assertRaises(crypto.DecryptionError):
                crypto.decrypt(legacy)                              # and the retired key really is gone

    def test_wrong_key_cannot_decrypt(self):
        from cryptography.fernet import Fernet

        token = crypto.encrypt("x")
        with override_settings(FIELD_ENCRYPTION_KEYS=[Fernet.generate_key().decode()]):
            with self.assertRaises(crypto.DecryptionError):
                crypto.decrypt(token)


class ProductionBootTests(APITestCase):
    """The app refuses to start in production without the settings that keep it safe."""

    def _boot(self, **env):
        import importlib
        import os

        from config import settings as s

        base = {"DJANGO_DEBUG": "False", "DJANGO_SECRET_KEY": "x" * 60, "DJANGO_ALLOWED_HOSTS": "example.com",
                "REDIS_URL": "redis://localhost:6379/0", "FIELD_ENCRYPTION_KEYS": "", "PAYMENTS_PROVIDER": "manual"}
        base.update(env)
        try:
            with mock.patch.dict(os.environ, base):
                importlib.reload(s)
        finally:
            importlib.reload(s)

    def test_refuses_to_boot_without_a_shared_cache(self):
        import os
        from django.core.exceptions import ImproperlyConfigured

        from cryptography.fernet import Fernet

        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("REDIS_URL", None)
            os.environ.pop("CACHE_REDIS_URL", None)
            with self.assertRaisesMessage(ImproperlyConfigured, "REDIS_URL"):
                self._boot(REDIS_URL="", FIELD_ENCRYPTION_KEYS=Fernet.generate_key().decode())

    def test_refuses_to_boot_without_an_encryption_key(self):
        from django.core.exceptions import ImproperlyConfigured

        with self.assertRaisesMessage(ImproperlyConfigured, "FIELD_ENCRYPTION_KEYS"):
            self._boot()

    def test_boots_when_everything_is_configured(self):
        from cryptography.fernet import Fernet

        self._boot(FIELD_ENCRYPTION_KEYS=Fernet.generate_key().decode())


class DjangoAdminSecurityTests(Base):
    """Django's own /admin/ used to sign in with a password alone — a back door around staff 2FA."""

    def setUp(self):
        super().setUp()
        self.staff = make_user("ops", staff=True)
        self.staff.is_superuser = True
        self.staff.save()

    def login(self, password=PASSWORD, otp=""):
        from django.test import Client

        c = Client()
        r = c.post("/admin/login/?next=/admin/", {"username": "ops", "password": password, "otp": otp})
        return c, r

    def logged_in(self, client):
        return client.get("/admin/").status_code == 200

    def test_a_staff_member_with_2fa_needs_the_code_as_well_as_the_password(self):
        secret = enable_2fa(self.staff)
        c, r = self.login()  # password only
        self.assertEqual(r.status_code, 200)  # form re-rendered with an error, not a redirect
        self.assertFalse(self.logged_in(c))
        c, r = self.login(otp="000000")
        self.assertFalse(self.logged_in(c))
        c, r = self.login(otp=totp_code(secret))
        self.assertEqual(r.status_code, 302)
        self.assertTrue(self.logged_in(c))

    @override_settings(REQUIRE_STAFF_2FA=True)
    def test_staff_without_2fa_cannot_use_the_django_admin_at_all(self):
        c, r = self.login()
        self.assertFalse(self.logged_in(c))
        self.assertIn("Two-factor authentication is required", r.content.decode())

    def test_the_otp_field_is_actually_on_the_login_page(self):
        from django.test import Client

        self.assertIn('name="otp"', Client().get("/admin/login/").content.decode())

    def test_guessing_admin_passwords_locks_the_account_out(self):
        for _ in range(5):
            self.login(password="wrong")
        c, r = self.login()  # correct password, but locked
        self.assertFalse(self.logged_in(c))
        self.assertIn("Too many failed attempts", r.content.decode())

    def test_wallet_balances_cannot_be_typed_into_the_admin(self):
        from apps.wallets.models import Wallet
        from django.contrib import admin as dj_admin
        from django.test import Client

        w = fund(self.alice, "GHS", 10)
        model_admin = dj_admin.site._registry[Wallet]
        for field in ("balance", "escrow_balance", "currency", "user"):
            self.assertIn(field, model_admin.readonly_fields)
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertFalse(model_admin.has_delete_permission(None))

        c = Client()
        c.force_login(self.staff)
        c.post(f"/admin/wallets/wallet/{w.pk}/change/", {"balance": "999999", "escrow_balance": "0", "_save": "Save"})
        w.refresh_from_db()
        self.assertEqual(w.balance, Decimal("10"))  # unchanged

    def test_admin_url_is_configurable(self):
        from django.conf import settings

        self.assertEqual(settings.ADMIN_URL, "admin/")


class FileValidationTests(APITestCase):
    """
    apps.security.file_validation — added alongside the audit fix for
    unrestricted attachment uploads. Checked against real bytes, not just
    the client-claimed Content-Type, since that header is spoofable.
    """

    def _upload(self, name, content, content_type):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, content, content_type=content_type)

    def _real_png_bytes(self):
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (2, 2), color=(10, 20, 30)).save(buf, format="PNG")
        return buf.getvalue()

    def test_a_real_image_passes(self):
        from apps.security.file_validation import validate_upload

        f = self._upload("photo.png", self._real_png_bytes(), "image/png")
        validate_upload(f)  # must not raise

    def test_a_disallowed_content_type_is_rejected(self):
        from rest_framework import serializers

        from apps.security.file_validation import validate_upload

        f = self._upload("payload.sh", b"#!/bin/sh\nrm -rf /\n", "application/x-sh")
        with self.assertRaises(serializers.ValidationError):
            validate_upload(f)

    def test_bytes_that_dont_match_the_claimed_type_are_rejected(self):
        """The exact spoofing attempt the audit was written against: a script claiming to be a jpeg."""
        from rest_framework import serializers

        from apps.security.file_validation import validate_upload

        f = self._upload("fake.jpg", b"#!/bin/sh\nrm -rf /\n", "image/jpeg")
        with self.assertRaises(serializers.ValidationError):
            validate_upload(f)

    def test_a_file_over_the_size_limit_is_rejected(self):
        from rest_framework import serializers

        from apps.security.file_validation import validate_upload

        f = self._upload("big.png", self._real_png_bytes(), "image/png")
        with self.assertRaises(serializers.ValidationError):
            validate_upload(f, max_bytes=10)  # smaller than any real PNG

    def test_a_pdf_signature_is_recognised(self):
        from apps.security.file_validation import validate_upload

        f = self._upload("doc.pdf", b"%PDF-1.4\n%mock pdf body", "application/pdf")
        validate_upload(f)  # must not raise
