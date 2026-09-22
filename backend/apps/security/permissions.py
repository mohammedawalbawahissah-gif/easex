from django.conf import settings
from rest_framework.permissions import BasePermission

from . import services


class IsStaffWith2FA(BasePermission):
    """
    Staff-only, AND (in production) staff must have two-factor authentication on.
    Staff can approve payouts and reveal card codes — their accounts are the most valuable
    target in the system, so a password alone isn't enough.
    """

    message = "Two-factor authentication is required for staff. Turn it on under Security settings."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.is_staff):
            return False
        if settings.REQUIRE_STAFF_2FA and not services.get_profile(user).totp_enabled:
            return False
        return True
