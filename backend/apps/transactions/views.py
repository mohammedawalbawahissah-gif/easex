from django.db import transaction as db_transaction
from apps.security.permissions import IsStaffWith2FA
from django.utils import timezone
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.compliance.models import AuditLog

from . import ledger
from .models import Transaction
from .serializers import AdminTransactionSerializer, TransactionSerializer


class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    A user's own transaction history. Read-only: value only moves through
    the dedicated endpoints (trade, gift cards, /api/payments/...), each of
    which builds the ledger rows on the server. Clients never create or
    edit transactions directly.
    """
    serializer_class = TransactionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Transaction.objects.filter(user=self.request.user).select_related("counter_wallet")


class AdminTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    The full ledger, for staff.

    `settle` moves a verified transaction to settled — the moment the
    signal in signals.py credits/debits the wallet. For a withdrawal it
    means "the payout has been sent" (releases the held funds).

    `transition` covers verify/reject/flag for transaction types that
    don't have their own specialised review UI (gift cards do — see
    AdminGiftCardSubmissionViewSet). Verifying a withdrawal also queues it
    for sending; rejecting one returns the held funds to the user.
    """
    serializer_class = AdminTransactionSerializer
    permission_classes = [IsStaffWith2FA]

    def get_queryset(self):
        qs = Transaction.objects.select_related("user", "wallet", "counter_wallet").order_by("-created_at")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        type_filter = self.request.query_params.get("type")
        if type_filter:
            qs = qs.filter(transaction_type__in=type_filter.split(","))  # comma-separated allowed
        return qs

    @action(detail=True, methods=["post"])
    def settle(self, request, pk=None):
        txn = self.get_object()
        try:
            with db_transaction.atomic():
                txn = ledger.settle_transaction(txn.pk, from_statuses=[Transaction.Status.VERIFIED])
                AuditLog.objects.create(
                    actor=request.user, action="transaction_settled",
                    target_model="Transaction", target_id=str(txn.pk),
                    details={"type": txn.transaction_type, "amount": str(txn.amount), "currency": txn.currency},
                )
        except ledger.InvalidTransition:
            raise serializers.ValidationError("Only a verified transaction can be settled.")
        except ledger.InsufficientFunds:
            raise serializers.ValidationError("The wallet no longer has the funds to settle this.")
        return Response(AdminTransactionSerializer(txn).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        new_status = request.data.get("status")
        valid = {Transaction.Status.VERIFIED, Transaction.Status.REJECTED, Transaction.Status.FLAGGED}
        if new_status not in valid:
            raise serializers.ValidationError({"status": "Must be 'verified', 'rejected', or 'flagged'."})

        with db_transaction.atomic():
            txn = Transaction.objects.select_for_update(no_key=True).get(pk=self.get_object().pk)
            # A flagged transaction can still be resolved either way once compliance has looked at it.
            reviewable = (Transaction.Status.PENDING, Transaction.Status.UNDER_REVIEW, Transaction.Status.FLAGGED)
            if txn.status not in reviewable or txn.status == new_status:
                raise serializers.ValidationError("This transaction has already moved past review.")
            if (
                txn.transaction_type == Transaction.TransactionType.GIFTCARD_SALE
                and new_status == Transaction.Status.VERIFIED
            ):
                # Gift cards are approved on the gift card screen, where the reviewer
                # attests the card was redeemed and the payout is computed from that.
                raise serializers.ValidationError(
                    "Approve gift cards from the gift card review screen, not here."
                )

            txn.status = new_status
            if new_status == Transaction.Status.VERIFIED:
                txn.verified_by = request.user
                txn.verified_at = timezone.now()
            if new_status == Transaction.Status.REJECTED:
                reason = (request.data.get("reason") or "").strip()[:200]
                if reason:
                    txn.metadata["rejection_reason"] = reason
            txn.save()  # signal turns a rejection of a held withdrawal into a refund

            AuditLog.objects.create(
                actor=request.user, action=f"transaction_{new_status}",
                target_model="Transaction", target_id=str(txn.pk),
                details={"type": txn.transaction_type, "amount": str(txn.amount), "currency": txn.currency},
            )

            if new_status == Transaction.Status.VERIFIED and txn.transaction_type in ledger.WITHDRAWAL_TYPES:
                from apps.payments.services import _dispatch_withdrawal

                _dispatch_withdrawal(txn.pk)
        return Response(AdminTransactionSerializer(txn).data)
