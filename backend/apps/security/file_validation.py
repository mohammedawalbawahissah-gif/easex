"""
Upload validation for user-submitted media — gift card evidence photos and
support chat attachments. Two independent apps (giftcards, support) share
this so "what counts as a safe upload" is defined once, not drifted apart.

Deliberately checks the file's actual leading bytes against known
signatures, not just `file.content_type` — that header is set by the
client and trivially spoofable (curl/Postman/a modified app build can claim
any Content-Type for any bytes). A real allowlist has to look at the file
itself.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

# (label, signature, offset) — offset is where the signature starts in the
# file, since some formats (WEBP, MP4) don't have their marker at byte 0.
_SIGNATURES = {
    "image/jpeg": [(b"\xff\xd8\xff", 0)],
    "image/png": [(b"\x89PNG\r\n\x1a\n", 0)],
    "image/webp": [(b"RIFF", 0), (b"WEBP", 8)],
    "application/pdf": [(b"%PDF-", 0)],
    # MP4/MOV-family containers: a 4-byte size field, then an "ftyp" box.
    # Different encoders write different sizes in that leading field, so
    # only the "ftyp" marker at offset 4 is checked, not the exact bytes
    # before it.
    "video/mp4": [(b"ftyp", 4)],
}

ALLOWED_CONTENT_TYPES = tuple(_SIGNATURES.keys())

# Matches DATA_UPLOAD_MAX_MEMORY_SIZE (settings.py) — kept as its own
# constant here so a caller can enforce it before the request body is even
# fully read, not just rely on Django's global cap.
MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

_SNIFF_BYTES = 32  # enough to cover every signature's offset + length above


def _matches_signature(head: bytes, content_type: str) -> bool:
    checks = _SIGNATURES.get(content_type)
    if not checks:
        return False
    return all(head[offset : offset + len(sig)] == sig for sig, offset in checks)


def validate_upload(file_obj, *, allowed_types=ALLOWED_CONTENT_TYPES, max_bytes=MAX_ATTACHMENT_BYTES) -> None:
    """
    Raises DRF's ValidationError if `file_obj` (an UploadedFile) isn't one
    of `allowed_types` — verified against its actual bytes — or exceeds
    `max_bytes`. Call this from a serializer's validate_<field> so the
    error surfaces as a normal 400 with a field-level message, not a 500.
    """
    if file_obj.size > max_bytes:
        raise serializers.ValidationError(
            f"File is too large ({file_obj.size // 1024} KB). Maximum is {max_bytes // (1024 * 1024)} MB."
        )

    claimed_type = getattr(file_obj, "content_type", "") or ""
    if claimed_type not in allowed_types:
        raise serializers.ValidationError(
            f"\"{claimed_type or 'unknown'}\" isn't an allowed file type. "
            f"Allowed: {', '.join(sorted(allowed_types))}."
        )

    try:
        file_obj.seek(0)
        head = file_obj.read(_SNIFF_BYTES)
        file_obj.seek(0)
    except (OSError, ValueError) as exc:
        raise serializers.ValidationError("Couldn't read the uploaded file.") from exc

    if not _matches_signature(head, claimed_type):
        raise serializers.ValidationError(
            f"This file's contents don't match a valid {claimed_type} file."
        )
