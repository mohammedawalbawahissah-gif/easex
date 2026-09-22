"""
Proof that rate limits and lockouts are SHARED between workers. These run against a real Redis
server (started in-process via `redislite`) and a real second OS process. Skipped if redislite
isn't installed; in CI/production-like environments, point CACHE_REDIS_URL at a real Redis.
"""

import os
import subprocess
import sys
import threading
from pathlib import Path

from django.core.cache import caches
from django.test import SimpleTestCase, override_settings

from . import lockout

try:
    import redislite
except ImportError:  # pragma: no cover
    redislite = None

BACKEND_DIR = Path(__file__).resolve().parents[2]


class RedisSharedCacheTests(SimpleTestCase):
    databases = set()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if redislite is None:
            from unittest import SkipTest

            raise SkipTest("redislite not installed")
        cls.server = redislite.Redis()
        cls.url = f"unix://{cls.server.socket_file}?db=1"
        cls.override = override_settings(CACHES={"default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": cls.url}})
        cls.override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.override.disable()
        cls.server.shutdown()
        super().tearDownClass()

    def setUp(self):
        caches["default"].clear()

    def test_the_cache_in_use_really_is_redis(self):
        self.assertEqual(type(caches["default"]).__name__, "RedisCache")

    def test_lockout_works_on_redis(self):
        for _ in range(lockout.MAX_ATTEMPTS):
            lockout.register_failure("login", "someone")
        with self.assertRaises(lockout.LockedOut):
            lockout.check("login", "someone")

    def test_a_lockout_set_by_ANOTHER_PROCESS_is_seen_here(self):
        """The whole point: worker A registers the failures, worker B enforces the lock."""
        script = (
            "import django; django.setup();"
            "from apps.security import lockout;"
            f"[lockout.register_failure('login', 'victim') for _ in range({lockout.MAX_ATTEMPTS})]"
        )
        env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings_test", "CACHE_REDIS_URL": self.url, "DJANGO_DEBUG": "True"}
        done = subprocess.run([sys.executable, "-c", script], cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        with self.assertRaises(lockout.LockedOut):
            lockout.check("login", "victim")

    def test_failures_counted_by_different_processes_add_up(self):
        script = (
            "import django; django.setup();"
            "from apps.security import lockout;"
            "[lockout.register_failure('login', 'shared') for _ in range(3)]"
        )
        env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings_test", "CACHE_REDIS_URL": self.url, "DJANGO_DEBUG": "True"}
        subprocess.run([sys.executable, "-c", script], cwd=BACKEND_DIR, env=env, check=True, timeout=60)
        lockout.register_failure("login", "shared")   # this process's 4th
        lockout.check("login", "shared")               # 4 < 5 : not locked yet
        lockout.register_failure("login", "shared")   # 5th failure overall, from two different processes
        with self.assertRaises(lockout.LockedOut):
            lockout.check("login", "shared")

    def test_concurrent_guessing_cannot_slip_past_the_counter(self):
        def guess():
            for _ in range(10):
                lockout.register_failure("login", "storm")

        threads = [threading.Thread(target=guess) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        with self.assertRaises(lockout.LockedOut):
            lockout.check("login", "storm")

    def test_locks_are_per_account_not_global(self):
        for _ in range(lockout.MAX_ATTEMPTS):
            lockout.register_failure("login", "alice")
        lockout.check("login", "bob")  # someone else is unaffected
