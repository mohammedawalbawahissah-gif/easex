import uuid

from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle


class AISessionThrottleTests(APITestCase):
    """
    SupportSessionViewSet.get_throttles — added alongside the audit fix
    for unbounded AI-session creation (each one wakes the assistant, which
    costs real API money). Only covers the throttle itself; the rest of
    the support app (guest access, escalation, attachments) predates this
    pass and isn't covered here — a separate gap, not addressed by this file.
    """

    def setUp(self):
        cache.clear()

    def test_the_11th_start_call_within_the_window_is_throttled(self):
        # DRF freezes ScopedRateThrottle.THROTTLE_RATES as a class attribute
        # at import time (rest_framework/throttling.py), copied once from
        # api_settings — django.test.override_settings does NOT reach back
        # into that already-set class attribute, only api_settings itself.
        # Patching the class attribute directly is the correct, standard
        # way to test a specific throttle rate; settings_test.py's generous
        # "100000/min" override is what every other test in the suite runs
        # under, which is why this needs to explicitly restore the real
        # tight rate rather than relying on settings alone.
        original_rates = ScopedRateThrottle.THROTTLE_RATES
        ScopedRateThrottle.THROTTLE_RATES = {**original_rates, "ai_session_start": "10/hour"}
        try:
            client = APIClient()
            statuses = []
            for _ in range(11):
                r = client.post("/api/support/start/", {"guest_id": str(uuid.uuid4())}, format="json")
                statuses.append(r.status_code)
            self.assertEqual(statuses[:10], [200] * 10)
            self.assertEqual(statuses[10], 429)
        finally:
            ScopedRateThrottle.THROTTLE_RATES = original_rates

    def test_list_is_not_bounded_by_the_tight_start_scope(self):
        client = APIClient()
        guest_id = str(uuid.uuid4())
        client.post("/api/support/start/", {"guest_id": guest_id}, format="json")
        for _ in range(15):
            r = client.get(f"/api/support/?guest_id={guest_id}")
            self.assertEqual(r.status_code, 200)
