from django.contrib import admin

from .models import SupportMessage, SupportSession


class MessageInline(admin.TabularInline):
    model = SupportMessage
    extra = 0
    fields = ["sender", "sender_admin", "body", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(SupportSession)
class SupportSessionAdmin(admin.ModelAdmin):
    """
    Read/inspect here if needed, but day-to-day triage should happen
    through the staff portal (web/src/pages/admin/SupportQueue.tsx),
    same division as gift cards and KYC.
    """

    list_display = ["id", "user", "status", "assigned_admin", "escalation_reason", "updated_at"]
    list_filter = ["status", "escalation_reason"]
    search_fields = ["user__username", "user__email", "subject"]
    readonly_fields = ["id", "created_at", "updated_at", "resolved_at"]
    inlines = [MessageInline]
