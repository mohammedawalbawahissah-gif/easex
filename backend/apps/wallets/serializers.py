from rest_framework import serializers
from .models import Wallet


class WalletSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wallet
        fields = ["id", "currency", "balance", "escrow_balance", "updated_at"]
        read_only_fields = fields  # wallets are never edited directly by clients
