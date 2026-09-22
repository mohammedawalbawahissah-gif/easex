from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "email", "phone_number", "kyc_tier", "is_flagged", "created_at"]
    list_filter = ["kyc_tier", "is_flagged", "is_active"]
    search_fields = ["username", "email", "phone_number"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("KYC & Compliance", {"fields": ("phone_number", "kyc_tier", "kyc_verified_at", "is_flagged")}),
    )
    actions = ["mark_kyc_full"]

    @admin.action(description="Manually mark selected users as Full KYC (emergency override)")
    def mark_kyc_full(self, request, queryset):
        # The normal path is now KYCSubmission review (see
        # apps/compliance/admin.py) — this stays as a manual override
        # for edge cases (support escalations, testing, migrated
        # accounts) where going through a submission doesn't make sense.
        for user in queryset:
            user.kyc_tier = User.KYCTier.FULL
            user.save()  # triggers kyc_verified_at stamping in User.save()
