import uuid

from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions import ledger
from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer
from apps.wallets.models import Wallet

from .models import ExchangeRate, ExchangeRateHistory, TradableCurrency
from .providers import get_provider
from .serializers import (
    ExchangeRateHistorySerializer,
    ExchangeRateSerializer,
    TradeRequestSerializer,
)


class RatesView(APIView):
    """Public-to-authenticated-users rate list — the frontend polls
    this before showing a trade form."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        rates = ExchangeRate.objects.all()
        return Response(ExchangeRateSerializer(rates, many=True).data)


class RateHistoryView(APIView):
    """
    Backs the rate-fluctuation chart on Trade. Optional
    ?currency=BTC filters to one asset; otherwise returns recent
    history for every tradable currency, oldest first, capped so
    the payload can't grow unbounded as snapshots accumulate.
    """
    permission_classes = [permissions.IsAuthenticated]
    MAX_POINTS_PER_CURRENCY = 200

    def get(self, request):
        currency = request.query_params.get("currency")
        if currency:
            if currency not in TradableCurrency.values:
                return Response({"detail": "Unknown currency."}, status=400)
            currencies = [currency]
        else:
            currencies = TradableCurrency.values

        points = []
        for c in currencies:
            recent = list(
                ExchangeRateHistory.objects.filter(currency=c)
                .order_by("-recorded_at")[: self.MAX_POINTS_PER_CURRENCY]
            )
            points.extend(reversed(recent))  # back to chronological order

        return Response(ExchangeRateHistorySerializer(points, many=True).data)


class TradeView(APIView):
    """
    Executes a buy or sell. See providers.py's module docstring for
    why this creates the transaction as pending FIRST and transitions
    it to settled as a separate step, rather than creating it
    pre-settled — that shape is what lets a real async provider slot
    in later without restructuring this view.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TradeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user
        crypto_currency = data["currency"]
        direction = data["direction"]
        crypto_amount = data["amount"]

        try:
            rate = ExchangeRate.objects.get(currency=crypto_currency)
        except ExchangeRate.DoesNotExist:
            return Response(
                {"detail": "This asset isn't available to trade right now."}, status=400
            )

        price = rate.buy_rate if direction == "buy" else rate.sell_rate
        ghs_amount = crypto_amount * price

        if direction == "buy" and ghs_amount > user.daily_limit():
            return Response(
                {
                    "detail": (
                        f"This trade ({ghs_amount:.2f} GHS) exceeds your verification "
                        f"limit of {user.daily_limit()} GHS."
                    )
                },
                status=400,
            )

        # Everything from the balance check to settlement runs in ONE
        # transaction with the user's wallets locked, so two simultaneous
        # trades can't both pass the balance check against the same money.
        try:
            with db_transaction.atomic():
                get_user_model().objects.select_for_update(no_key=True).get(pk=user.pk)
                ghs_wallet, _ = Wallet.objects.get_or_create(user=user, currency=Wallet.Currency.GHS)
                crypto_wallet, _ = Wallet.objects.get_or_create(user=user, currency=crypto_currency)
                locked = {
                    w.pk: w
                    for w in Wallet.objects.select_for_update(no_key=True)
                    .filter(pk__in=[ghs_wallet.pk, crypto_wallet.pk])
                    .order_by("pk")
                }
                ghs_balance = locked[ghs_wallet.pk].balance
                crypto_balance = locked[crypto_wallet.pk].balance

                if direction == "buy" and ghs_balance < ghs_amount:
                    return Response({"detail": "Insufficient GHS balance for this trade."}, status=400)
                if direction == "sell" and crypto_balance < crypto_amount:
                    return Response(
                        {"detail": f"Insufficient {crypto_currency} balance for this trade."}, status=400
                    )

                # "wallet" = what's received, "counter_wallet" = what's paid from.
                if direction == "buy":
                    receiving_wallet, paying_wallet = crypto_wallet, ghs_wallet
                    amount, currency = crypto_amount, crypto_currency
                    counter_amount = ghs_amount
                else:
                    receiving_wallet, paying_wallet = ghs_wallet, crypto_wallet
                    amount, currency = ghs_amount, Wallet.Currency.GHS
                    counter_amount = crypto_amount

                txn = Transaction.objects.create(
                    user=user,
                    wallet=receiving_wallet,
                    counter_wallet=paying_wallet,
                    transaction_type=Transaction.TransactionType.CRYPTO_TRADE,
                    status=Transaction.Status.PENDING,
                    amount=amount,
                    currency=currency,
                    idempotency_key=str(uuid.uuid4()),
                    metadata={
                        "direction": direction,
                        "rate": str(price),
                        "counter_amount": str(counter_amount),
                    },
                )

                # NOTE: with a real, network-backed provider this call must move
                # OUT of the database transaction (see providers.py docstring).
                provider = get_provider()
                result = provider.execute_trade(
                    currency=crypto_currency,
                    direction=direction,
                    crypto_amount=crypto_amount,
                    ghs_amount=ghs_amount,
                )

                txn.external_reference = result["external_reference"]
                txn.status = (
                    Transaction.Status.SETTLED
                    if result["status"] == "settled"
                    else Transaction.Status.UNDER_REVIEW
                )
                txn.save()  # separate save — this is what triggers the settlement signal
        except ledger.InsufficientFunds:
            return Response({"detail": "Insufficient balance for this trade."}, status=400)

        return Response(TransactionSerializer(txn).data, status=201)
