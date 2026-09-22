from rest_framework.throttling import SimpleRateThrottle


class SensitiveActionThrottle(SimpleRateThrottle):
    """Tight per-user limit (the "sensitive" rate) for actions like revealing a card code."""

    scope = "sensitive"

    def get_cache_key(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
