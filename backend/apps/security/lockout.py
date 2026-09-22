"""
Account-level lockouts, kept in the SHARED cache (Redis) so every web worker agrees.

Counted per ACCOUNT (or per typed username at login), not per IP — otherwise an attacker
just spreads guesses across many IPs. Locks apply to any username string, real or not, so
"locked" can't be used to discover which usernames exist.
"""

import time

from django.core.cache import cache

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60
LOCK_SECONDS = 15 * 60


class LockedOut(Exception):
    def __init__(self, retry_after: int):
        super().__init__("Too many failed attempts.")
        self.retry_after = retry_after


def _fail_key(scope, ident):
    return f"sec:fail:{scope}:{ident}"


def _lock_key(scope, ident):
    return f"sec:lock:{scope}:{ident}"


def check(scope: str, ident) -> None:
    """Raise LockedOut if this scope+ident is currently locked."""
    until = cache.get(_lock_key(scope, str(ident)))
    if until:
        remaining = int(until - time.time())
        if remaining > 0:
            raise LockedOut(remaining)


def register_failure(scope: str, ident) -> None:
    ident = str(ident)
    key = _fail_key(scope, ident)
    cache.add(key, 0, WINDOW_SECONDS)  # only creates it if missing; atomic in Redis
    try:
        count = cache.incr(key)
    except ValueError:  # expired between add and incr
        cache.set(key, 1, WINDOW_SECONDS)
        count = 1
    if count >= MAX_ATTEMPTS:
        cache.set(_lock_key(scope, ident), time.time() + LOCK_SECONDS, LOCK_SECONDS)
        cache.delete(key)


def clear(scope: str, ident) -> None:
    cache.delete(_fail_key(scope, str(ident)))
