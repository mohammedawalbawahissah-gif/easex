from django.conf import settings

from apps.security import services as security
from apps.security.permissions import IsStaffWith2FA
from apps.security.services import SecurityError
from apps.security.views import security_error_response
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import models
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import (
    AdminUserSerializer,
    ChangePasswordSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
)

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    """Public registration endpoint. Issues JWT tokens on success
    so the client doesn't need a separate login call right after."""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response({
            "user": UserSerializer(user).data,
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        }, status=201)


class MeView(APIView):
    """Returns the authenticated user's own profile — same endpoint
    for web and mobile, keeping the two frontends in lockstep."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    """Requires the current password — this is an authenticated
    user changing their own password, not an account-recovery flow."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user

        try:
            security.verify_password(user, serializer.validated_data["old_password"])
            security.require_otp_if_enabled(user, request.data.get("otp"))
        except SecurityError as exc:
            return security_error_response(exc)

        user.set_password(serializer.validated_data["new_password"])
        user.save()
        # A stolen session must not survive a password change. This device gets fresh tokens.
        security.revoke_sessions(user)
        return Response({"detail": "Password updated.", "tokens": security.issue_tokens(user)})


class PasswordResetRequestView(APIView):
    """Account-recovery entry point for a logged-out user. Always
    returns the same response regardless of whether the email exists,
    so this endpoint can't be used to enumerate registered accounts."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        generic_response = Response(
            {"detail": "If that email is registered, a reset link has been sent."}
        )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return generic_response

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        reset_link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"

        send_mail(
            subject="Reset your EaseX password",
            message=(
                f"Use this link to reset your password:\n\n{reset_link}\n\n"
                "If you didn't request this, you can safely ignore this email."
            ),
            from_email=None,  # uses DEFAULT_FROM_EMAIL
            recipient_list=[email],
        )
        return generic_response


class PasswordResetConfirmView(APIView):
    """The second half of the recovery flow — the uid/token pair
    from the emailed link, plus the new password."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            uid = force_str(urlsafe_base64_decode(serializer.validated_data["uid"]))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"detail": "Invalid reset link."}, status=400)

        if not default_token_generator.check_token(user, serializer.validated_data["token"]):
            return Response({"detail": "This reset link is invalid or has expired."}, status=400)

        user.set_password(serializer.validated_data["new_password"])
        user.save()
        # Reset only proves control of an email inbox — so it signs out every session, and money
        # can't leave the account for a while (see SECURITY_COOLING_OFF_HOURS). It does NOT touch
        # the PIN or 2FA: an attacker who owns the inbox still can't move money.
        security.revoke_sessions(user)
        security.start_cooling_off(user)
        return Response({"detail": "Password has been reset. You can now log in."})


class AdminUserViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Staff-only user directory for the admin portal — search and a
    manual flag toggle. Everything else about a user (KYC, gift
    cards, transactions) is reviewed through its own admin viewset
    rather than duplicated here.
    """
    serializer_class = AdminUserSerializer
    permission_classes = [IsStaffWith2FA]

    def get_queryset(self):
        qs = User.objects.all().order_by("-created_at")
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                models.Q(username__icontains=search)
                | models.Q(email__icontains=search)
                | models.Q(phone_number__icontains=search)
            )
        kyc_tier = self.request.query_params.get("kyc_tier")
        if kyc_tier:
            qs = qs.filter(kyc_tier=kyc_tier)
        flagged = self.request.query_params.get("is_flagged")
        if flagged is not None:
            qs = qs.filter(is_flagged=flagged.lower() == "true")
        return qs

    @action(detail=True, methods=["post"])
    def toggle_flag(self, request, pk=None):
        user = self.get_object()
        user.is_flagged = not user.is_flagged
        user.save(update_fields=["is_flagged"])
        return Response(AdminUserSerializer(user).data)
