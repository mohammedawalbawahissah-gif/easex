from rest_framework import serializers

from .models import ComplianceRiskSettings, GiftCardAssessment, KYCAssessment


class KYCAssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = KYCAssessment
        fields = [
            "extracted_full_name",
            "extracted_date_of_birth",
            "name_matches",
            "dob_matches",
            "face_impression",
            "notes",
            "assessed_at",
        ]
        read_only_fields = fields


class GiftCardAssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GiftCardAssessment
        fields = ["detected_brand", "detected_value_text", "consistency", "notes", "assessed_at"]
        read_only_fields = fields


class ComplianceRiskSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComplianceRiskSettings
        fields = [
            "velocity_detection_enabled",
            "velocity_window_minutes",
            "velocity_max_transactions",
            "structuring_detection_enabled",
            "structuring_window_hours",
            "structuring_min_transaction_count",
            "structuring_sum_threshold_ratio",
            "kyc_assist_enabled",
            "giftcard_assist_enabled",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]
