from django.contrib import admin
from django.utils.html import format_html

from .models import AuditLog, ComplianceFlag, KYCSubmission


@admin.register(ComplianceFlag)
class ComplianceFlagAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "reason", "status", "created_at", "resolved_at"]
    list_filter = ["reason", "status"]
    search_fields = ["user__username"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only in admin — audit logs are append-only, never edited."""
    list_display = ["action", "actor", "target_model", "target_id", "created_at"]
    list_filter = ["action", "target_model"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


def _image_preview(image_field, label):
    if not image_field:
        return "—"
    return format_html(
        '<a href="{0}" target="_blank"><img src="{0}" style="max-height:220px;max-width:320px;'
        'border:1px solid #ccc;border-radius:4px;" /></a><br><small>{1} — click to open full size</small>',
        image_field.url,
        label,
    )


@admin.register(KYCSubmission)
class KYCSubmissionAdmin(admin.ModelAdmin):
    """
    The review queue for Full-tier verification. Approving or
    rejecting here (by changing `status` and saving) is what
    actually bumps the user's tier and notifies them — see
    apps/compliance/signals.py. This is the interim review surface
    until a dedicated staff portal exists.
    """
    list_display = ["full_name", "user", "id_type", "status", "submitted_at", "reviewed_at", "reviewed_by"]
    list_filter = ["status", "id_type"]
    search_fields = ["full_name", "id_number", "user__username", "user__email"]
    readonly_fields = ["user", "submitted_at", "reviewed_at", "front_preview", "back_preview", "selfie_preview"]
    fieldsets = (
        ("Applicant", {"fields": ("user", "full_name", "date_of_birth", "id_type", "id_number", "submitted_at")}),
        ("Evidence", {"fields": ("front_preview", "back_preview", "selfie_preview")}),
        ("Review decision", {"fields": ("status", "rejection_reason", "reviewed_by", "reviewed_at")}),
    )
    actions = ["approve_selected", "reject_selected"]

    @admin.display(description="ID front")
    def front_preview(self, obj):
        return _image_preview(obj.id_document_front, "ID front")

    @admin.display(description="ID back")
    def back_preview(self, obj):
        return _image_preview(obj.id_document_back, "ID back")

    @admin.display(description="Selfie")
    def selfie_preview(self, obj):
        return _image_preview(obj.selfie, "Selfie")

    def save_model(self, request, obj, form, change):
        # Whoever's logged into admin and changes the status is the
        # reviewer of record — set it here rather than trusting a
        # form field, so it can't be spoofed.
        if "status" in form.changed_data:
            obj.reviewed_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description="Approve selected submissions")
    def approve_selected(self, request, queryset):
        for submission in queryset.filter(status=KYCSubmission.Status.PENDING):
            submission.status = KYCSubmission.Status.APPROVED
            submission.reviewed_by = request.user
            submission.save()

    @admin.action(description="Reject selected submissions")
    def reject_selected(self, request, queryset):
        # Bulk reject with a generic reason — for a specific reason,
        # reject individually via the detail page's rejection_reason field.
        for submission in queryset.filter(status=KYCSubmission.Status.PENDING):
            submission.status = KYCSubmission.Status.REJECTED
            submission.rejection_reason = submission.rejection_reason or "Documents did not pass review."
            submission.reviewed_by = request.user
            submission.save()
