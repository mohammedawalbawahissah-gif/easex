"""
Serves a sensitive uploaded file (a KYC document, gift-card evidence photo)
through Django rather than directly from MEDIA_URL, so viewing it requires
being either the person who uploaded it or a staff reviewer — not just
knowing the URL.

Used by apps.compliance (KYC images) and apps.giftcards (card photo +
evidence gallery), which otherwise share no code — kept here rather than
in either app so neither depends on the other for something this generic.
"""

import mimetypes

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework.exceptions import PermissionDenied

from apps.security import services as security_services


def is_owner_or_staff_reviewer(user, owner_id) -> bool:
    """
    The same access rule everywhere sensitive user-uploaded media is
    served: the uploader themselves, or staff — and if REQUIRE_STAFF_2FA
    is on, only staff who actually have 2FA enabled, matching
    IsStaffWith2FA's own check elsewhere.
    """
    if not (user and user.is_authenticated):
        return False
    if user.pk == owner_id:
        return True
    if not user.is_staff:
        return False
    if settings.REQUIRE_STAFF_2FA and not security_services.get_profile(user).totp_enabled:
        return False
    return True


def serve_owned_file(request, *, file_field, owner_id):
    """
    file_field: a Django FieldFile (e.g. submission.selfie). owner_id: the
    pk of the user who owns the object this file belongs to. Raises
    Http404 if there's no file, PermissionDenied if the requester is
    neither the owner nor an eligible staff reviewer.
    """
    if not file_field:
        raise Http404
    if not is_owner_or_staff_reviewer(request.user, owner_id):
        raise PermissionDenied("You don't have access to this file.")

    content_type, _ = mimetypes.guess_type(file_field.name)
    return FileResponse(file_field.open("rb"), content_type=content_type or "application/octet-stream")
