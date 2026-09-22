from rest_framework import serializers

from . import ledger
from .models import Transaction

# Bookkeeping the client has no business seeing (hold state, provider
# dispatch markers, reconciliation notes).
INTERNAL_METADATA_KEYS = {
    ledger.HOLD_KEY,
    "dispatched_at",
    "provider_state",
    "needs_reconciliation",
    "reconciliation_note",
    "auto_approved",
    "source",
}


class AdminTransactionSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    counter_currency = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id", "user", "username", "wallet", "counter_wallet", "transaction_type", "status",
            "amount", "currency", "counter_currency", "idempotency_key", "external_reference",
            "metadata", "verified_by", "verified_at", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_counter_currency(self, obj):
        return obj.counter_wallet.currency if obj.counter_wallet_id else None


class TransactionSerializer(serializers.ModelSerializer):
    """
    Strictly read-only. Transactions are created only by server-side
    services (trade, gift card, payments) — never from client-supplied
    field values, which previously let any user write a ledger row against
    any wallet id.

    Extras exposed so clients can reconstruct accurate per-currency balance
    history from the transaction list alone — without counter_currency, a
    two-sided crypto trade's "paid from" leg (counter_wallet +
    metadata.counter_amount) would be invisible to the client entirely.
    """

    counter_currency = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id", "wallet", "transaction_type", "status", "amount", "currency",
            "idempotency_key", "external_reference", "metadata", "counter_currency",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_counter_currency(self, obj):
        return obj.counter_wallet.currency if obj.counter_wallet_id else None

    def get_metadata(self, obj):
        return {k: v for k, v in (obj.metadata or {}).items() if k not in INTERNAL_METADATA_KEYS}
