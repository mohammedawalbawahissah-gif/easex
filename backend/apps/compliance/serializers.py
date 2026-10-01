from django.urls import reverse
from rest_framework import serializers

from apps.users.models import User
from .models import ComplianceFlag, KYCSubmission

KYC_IMAGE_FIELDS = ("id_document_front", "id_document_back", "selfie")


def _use_authenticated_image_urls(data, instance, request):
    """
    Swaps each field's raw MEDIA_URL for the authenticated KYCImageView
    URL — these are ID documents and selfies; unlike most media, "you
    have the link" should never be enough to view them. Read-side only —
    the underlying model fields stay writable as normal FileFields, this
    just changes what URL comes back in a response.
    """
    for field in KYC_IMAGE_FIELDS:
        if data.get(field):
            path = reverse("kyc-image", kwargs={"submission_id": instance.pk, "field": field})
            data[field] = request.build_absolute_uri(path) if request else path
        else:
            data[field] = None
    return data


class KYCSubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = KYCSubmission
        fields = [
            "id", "full_name", "date_of_birth", "id_type", "id_number",
            "id_document_front", "id_document_back", "selfie",
            "status", "rejection_reason", "submitted_at", "reviewed_at",
        ]
        read_only_fields = ["id", "status", "rejection_reason", "submitted_at", "reviewed_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _use_authenticated_image_urls(data, instance, self.context.get("request"))

    def validate(self, attrs):
        user = self.context["request"].user

        if user.kyc_tier == User.KYCTier.FULL:
            raise serializers.ValidationError("Your account is already fully verified.")

        if KYCSubmission.objects.filter(user=user, status=KYCSubmission.Status.PENDING).exists():
            raise serializers.ValidationError(
                "You already have a submission under review. Please wait for it to be reviewed."
            )

        return attrs

    def create(self, validated_data):
        return KYCSubmission.objects.create(user=self.context["request"].user, **validated_data)


class AdminKYCSubmissionSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)
    current_tier = serializers.CharField(source="user.kyc_tier", read_only=True)

    class Meta:
        model = KYCSubmission
        fields = [
            "id", "user", "username", "email", "current_tier", "full_name", "date_of_birth",
            "id_type", "id_number", "id_document_front", "id_document_back", "selfie",
            "status", "rejection_reason", "reviewed_by", "reviewed_at", "submitted_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _use_authenticated_image_urls(data, instance, self.context.get("request"))


class ComplianceFlagSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = ComplianceFlag
        fields = [
            "id", "user", "username", "transaction", "reason", "status",
            "notes", "raised_by", "created_at", "resolved_at",
        ]
        read_only_fields = ["id", "user", "transaction", "reason", "raised_by", "created_at", "resolved_at"]
