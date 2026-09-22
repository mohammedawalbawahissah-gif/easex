from django.contrib import admin

from .models import (
    DepositAddress,
    PaymentSettings,
    PayoutDestination,
    PayoutPreference,
    ScheduledLoad,
    ScheduledTransfer,
    ScheduledWithdrawal,
)


@admin.register(PaymentSettings)
class PaymentSettingsAdmin(admin.ModelAdmin):
    """One row. This is where you turn gift-card auto-payment on and set the
    'how much can happen without a human' thresholds."""

    fieldsets = [
        ("Kill switches", {"fields": ["loads_enabled", "withdrawals_enabled", "transfers_enabled"]}),
        ("Withdrawals", {"fields": ["withdrawal_auto_approve_max_ghs"]}),
        (
            "Gift card auto-payment",
            {
                "fields": [
                    "giftcard_auto_payment_enabled",
                    "giftcard_auto_payout_max_ghs",
                    "auto_payout_destination_cooldown_hours",
                ]
            },
        ),
        ("Wallet loading", {"fields": ["manual_deposit_instructions"]}),
    ]

    def has_add_permission(self, request):
        return not PaymentSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ScheduledTransfer)
class ScheduledTransferAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "recipient", "currency", "amount", "run_at", "status"]
    list_filter = ["status", "currency"]
    search_fields = ["user__username", "recipient__username"]
    readonly_fields = [f.name for f in ScheduledTransfer._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(ScheduledLoad)
class ScheduledLoadAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "amount", "network", "run_at", "status"]
    list_filter = ["status", "network"]
    search_fields = ["user__username", "phone_number"]
    readonly_fields = [f.name for f in ScheduledLoad._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(ScheduledWithdrawal)
class ScheduledWithdrawalAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "currency", "amount", "run_at", "status"]
    list_filter = ["status", "currency"]
    search_fields = ["user__username"]
    readonly_fields = [f.name for f in ScheduledWithdrawal._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(PayoutDestination)
class PayoutDestinationAdmin(admin.ModelAdmin):
    list_display = ["user", "network", "account_number", "account_name", "is_active", "created_at"]
    list_filter = ["network", "is_active"]
    search_fields = ["user__username", "account_number"]


admin.site.register(PayoutPreference)
admin.site.register(DepositAddress)
