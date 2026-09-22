from django.contrib import admin

from .models import ComplianceRiskSettings, GiftCardAssessment, KYCAssessment


@admin.register(ComplianceRiskSettings)
class ComplianceRiskSettingsAdmin(admin.ModelAdmin):
    """Singleton — Django admin will just show the one row to edit."""

    def has_add_permission(self, request):
        return not ComplianceRiskSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(KYCAssessment)
class KYCAssessmentAdmin(admin.ModelAdmin):
    list_display = ["submission", "face_impression", "name_matches", "dob_matches", "assessed_at"]
    list_filter = ["face_impression", "name_matches", "dob_matches"]
    readonly_fields = [f.name for f in KYCAssessment._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(GiftCardAssessment)
class GiftCardAssessmentAdmin(admin.ModelAdmin):
    list_display = ["submission", "consistency", "detected_brand", "assessed_at"]
    list_filter = ["consistency"]
    readonly_fields = [f.name for f in GiftCardAssessment._meta.fields]

    def has_add_permission(self, request):
        return False
