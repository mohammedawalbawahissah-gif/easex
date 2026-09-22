from django.contrib import admin

from .models import SecurityProfile


@admin.register(SecurityProfile)
class SecurityProfileAdmin(admin.ModelAdmin):
    """Read-only. Secrets are never shown; only whether the protections are on."""

    list_display = ["user", "pin_set_display", "totp_enabled_display", "money_out_blocked_until"]
    search_fields = ["user__username"]
    fields = ["user", "pin_set_at", "totp_confirmed_at", "money_out_blocked_until"]
    readonly_fields = fields

    @admin.display(boolean=True, description="PIN set")
    def pin_set_display(self, obj):
        return obj.pin_set

    @admin.display(boolean=True, description="2FA on")
    def totp_enabled_display(self, obj):
        return obj.totp_enabled

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
