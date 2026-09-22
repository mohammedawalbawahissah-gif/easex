from rest_framework import serializers

from .models import SupportMessage, SupportSession


class SupportMessageSerializer(serializers.ModelSerializer):
    sender_admin_username = serializers.CharField(source="sender_admin.username", read_only=True, default=None)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = SupportMessage
        fields = [
            "id",
            "sender",
            "sender_admin_username",
            "body",
            "attachment_url",
            "attachment_name",
            "attachment_content_type",
            "created_at",
        ]
        read_only_fields = fields

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return None
        request = self.context.get("request")
        url = obj.attachment.url
        return request.build_absolute_uri(url) if request else url


class SupportSessionSerializer(serializers.ModelSerializer):
    """User-facing: their own session plus its transcript."""

    messages = SupportMessageSerializer(many=True, read_only=True)

    class Meta:
        model = SupportSession
        fields = ["id", "status", "subject", "created_at", "updated_at", "resolved_at", "messages"]
        read_only_fields = fields


class AdminSupportSessionSerializer(serializers.ModelSerializer):
    """Staff queue view — same transcript, plus who's involved."""

    username = serializers.SerializerMethodField()
    assigned_admin_username = serializers.CharField(
        source="assigned_admin.username", read_only=True, default=None
    )
    messages = SupportMessageSerializer(many=True, read_only=True)

    class Meta:
        model = SupportSession
        fields = [
            "id",
            "username",
            "status",
            "subject",
            "escalation_reason",
            "escalation_notes",
            "assigned_admin_username",
            "created_at",
            "updated_at",
            "resolved_at",
            "messages",
        ]
        read_only_fields = fields

    def get_username(self, obj):
        if obj.user_id:
            return obj.user.username
        return f"Guest ({str(obj.guest_id)[:8]})" if obj.guest_id else "Guest"
