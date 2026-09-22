from django.contrib import admin
from .models import Transaction


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = [
        "id", "user", "transaction_type", "status", "amount",
        "currency", "created_at", "verified_by",
    ]
    list_filter = ["transaction_type", "status", "currency"]
    search_fields = ["user__username", "idempotency_key", "external_reference"]
    readonly_fields = ["id", "created_at", "updated_at"]
    actions = ["mark_verified"]

    def get_readonly_fields(self, request, obj=None):
        # A settled/rejected transaction is history: money has moved (or
        # been returned). Editing it would desync balances from the ledger.
        if obj and obj.status in ("settled", "rejected"):
            return [f.name for f in self.model._meta.fields]
        return self.readonly_fields

    @admin.action(description="Mark selected transactions as verified (only ones still awaiting review)")
    def mark_verified(self, request, queryset):
        from django.utils import timezone
        # queryset.update() bypasses the model signals, so it must never be
        # allowed to touch a transaction that has already settled — that
        # would let it be settled a second time.
        queryset.filter(
            status__in=[Transaction.Status.PENDING, Transaction.Status.UNDER_REVIEW]
        ).update(status=Transaction.Status.VERIFIED, verified_at=timezone.now(), verified_by=request.user)
