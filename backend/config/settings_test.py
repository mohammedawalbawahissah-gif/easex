"""
Settings for running the test suite:

    python manage.py test --settings=config.settings_test

Runs Celery tasks inline (no Redis needed) and uses a fast password
hasher. Never use this module outside tests.
"""
from .settings import *  # noqa: F401,F403

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# The real throttle rates are deliberately tight; tests hit endpoints far
# faster than a person would. test_throttling checks the real behaviour.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "user": "100000/min", "anon": "100000/min", "money_out": "100000/min",
        "money_in": "100000/min", "lookup": "100000/min", "money": "100000/min", "sensitive": "100000/min",
    },
}

# Staff 2FA is enforced in production; most tests aren't about it. test_security turns it on.
REQUIRE_STAFF_2FA = False
