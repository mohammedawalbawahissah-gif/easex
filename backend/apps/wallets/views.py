from django.db.models import Case, When

from rest_framework import permissions, viewsets

from .models import Wallet
from .serializers import WalletSerializer


class WalletViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only — wallet balances are derived from the transaction
    ledger and must never be mutated via this API directly."""
    serializer_class = WalletSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        # A Wallet row only exists once a user has touched that
        # currency (first deposit/trade). The client's "All wallets"
        # view is meant to show every supported currency though — so
        # backfill zero-balance rows for anything missing. Safe to do
        # on a read: balance defaults to 0, which is exactly what "no
        # activity in this currency yet" should show.
        existing = set(
            Wallet.objects.filter(user=user).values_list("currency", flat=True)
        )
        missing = [c for c, _ in Wallet.Currency.choices if c not in existing]
        if missing:
            Wallet.objects.bulk_create(
                [Wallet(user=user, currency=c) for c in missing],
                ignore_conflicts=True,
            )

        # Keep a stable, sensible order (GHS first, then crypto in
        # the order they're declared) rather than whatever order the
        # rows happen to have been created in.
        ordering = Case(
            *[
                When(currency=c, then=i)
                for i, (c, _) in enumerate(Wallet.Currency.choices)
            ]
        )
        return Wallet.objects.filter(user=user).order_by(ordering)
