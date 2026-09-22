from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class SecureJWTAuthentication(JWTAuthentication):
    """
    SimpleJWT, plus: a token issued BEFORE the user's last security event (password
    change/reset, 2FA change) is refused. Refresh tokens are blacklisted at that moment,
    but an already-issued access token would otherwise stay valid for up to 15 minutes.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        issued_at = validated_token.get("iat")
        epoch = getattr(user, "security_epoch", None)
        if issued_at is not None and epoch is not None:
            if int(issued_at) < int(epoch.timestamp()):
                raise AuthenticationFailed("Your session has ended. Please sign in again.", code="session_revoked")
        return user
