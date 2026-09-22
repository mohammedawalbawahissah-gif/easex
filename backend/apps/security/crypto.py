"""
Field-level encryption for secrets that must be recoverable (gift card codes awaiting
redemption, 2FA secrets). Fernet = AES-128-CBC + HMAC-SHA256, authenticated, with a timestamp.

Keys come from settings.FIELD_ENCRYPTION_KEYS. The first key encrypts; every key can decrypt,
so rotation is: prepend a new key, deploy, (optionally) re-encrypt, later drop the old key.
"""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


class DecryptionError(Exception):
    """The ciphertext is corrupt or was encrypted with a key that is no longer configured."""


def _fernet() -> MultiFernet:
    return MultiFernet([Fernet(k.encode()) for k in settings.FIELD_ENCRYPTION_KEYS])


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise DecryptionError("Could not decrypt (wrong or missing key).") from exc
