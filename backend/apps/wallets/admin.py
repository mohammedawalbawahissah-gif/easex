from django.contrib import admin
from .models import Wallet


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    """
    VIEW ONLY. Balances change only through the ledger (apps/transactions/ledger.py), which keeps every
    movement backed by a transaction. Letting someone type a new balance here would create or destroy
    money with no record — so nothing on this page is editable, and wallets can't be added or deleted.
    """
    list_display = ["user", "currency", "balance", "escrow_balance", "updated_at"]
    list_filter = ["currency"]
    search_fields = ["user__username", "user__email"]
    readonly_fields = ["user", "currency", "balance", "escrow_balance", "updated_at"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
