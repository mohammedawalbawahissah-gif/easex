from decimal import Decimal

from rest_framework import serializers

from .models import ExchangeRate, ExchangeRateHistory, TradableCurrency


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = ["currency", "buy_rate", "sell_rate", "updated_at"]


class ExchangeRateHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRateHistory
        fields = ["currency", "buy_rate", "sell_rate", "recorded_at"]


class TradeRequestSerializer(serializers.Serializer):
    currency = serializers.ChoiceField(choices=TradableCurrency.choices)
    direction = serializers.ChoiceField(choices=["buy", "sell"])
    # Always specified in the CRYPTO currency's own units, whichever
    # direction — buying 0.01 BTC or selling 0.01 BTC, never GHS units.
    amount = serializers.DecimalField(max_digits=20, decimal_places=8, min_value=Decimal("0.00000001"))
