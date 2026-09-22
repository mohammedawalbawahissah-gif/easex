from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "username", "email", "phone_number",
            "kyc_tier", "kyc_verified_at", "is_staff", "created_at",
        ]
        read_only_fields = ["id", "kyc_tier", "kyc_verified_at", "is_staff", "created_at"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=10)

    class Meta:
        model = User
        fields = ["username", "email", "phone_number", "password"]

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        # Basic tier's definition (phone + email) is already satisfied
        # by registration itself — there's no reason to leave a fresh
        # account stuck at Unverified with a 0 transaction limit.
        user.kyc_tier = User.KYCTier.BASIC
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=10)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=10)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class AdminUserSerializer(serializers.ModelSerializer):
    """Fuller view of a user for the staff portal — includes fields
    a customer never needs to see about themselves (is_staff,
    is_flagged, is_active)."""

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "phone_number",
            "kyc_tier", "kyc_verified_at", "is_flagged", "is_staff",
            "is_active", "created_at",
        ]
        read_only_fields = fields
