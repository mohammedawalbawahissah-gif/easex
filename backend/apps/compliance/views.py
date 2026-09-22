from django.contrib.auth import get_user_model
from apps.security.permissions import IsStaffWith2FA
from django.utils import timezone
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.giftcards.models import GiftCardSubmission
from apps.payments.models import PaymentSettings
from apps.transactions.models import Transaction
from .models import ComplianceFlag, KYCSubmission
from .serializers import (
    AdminKYCSubmissionSerializer,
    ComplianceFlagSerializer,
    KYCSubmissionSerializer,
)

User = get_user_model()


class KYCSubmissionViewSet(viewsets.ModelViewSet):
    """
    Users submit verification evidence and view their own submission
    history/status. Review (approve/reject) happens through
    AdminKYCSubmissionViewSet below (or Django admin).
    """
    serializer_class = KYCSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head"]

    def get_queryset(self):
        return KYCSubmission.objects.filter(user=self.request.user)


class AdminKYCSubmissionViewSet(viewsets.ReadOnlyModelViewSet):
    """The staff review queue. `review` sets status, which
    apps/compliance/signals.py turns into the tier bump/notification/
    audit log — same as changing status in Django admin does."""
    serializer_class = AdminKYCSubmissionSerializer
    permission_classes = [IsStaffWith2FA]

    def get_queryset(self):
        qs = KYCSubmission.objects.select_related("user").order_by("-submitted_at")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        submission = self.get_object()
        decision = request.data.get("decision")
        if decision not in ("approve", "reject"):
            raise serializers.ValidationError({"decision": "Must be 'approve' or 'reject'."})
        if submission.status != KYCSubmission.Status.PENDING:
            raise serializers.ValidationError("This submission has already been reviewed.")

        submission.reviewed_by = request.user
        submission.status = KYCSubmission.Status.APPROVED if decision == "approve" else KYCSubmission.Status.REJECTED
        if decision == "reject":
            submission.rejection_reason = request.data.get("rejection_reason", "")
        submission.save()  # pre_save/post_save signals handle the rest

        return Response(AdminKYCSubmissionSerializer(submission).data)


class ComplianceFlagViewSet(viewsets.ReadOnlyModelViewSet):
    """Staff queue for suspicious-activity flags — both system-raised
    (e.g. duplicate gift card codes) and manually raised ones (e.g.
    from a gift card 'flag' review decision)."""
    serializer_class = ComplianceFlagSerializer
    permission_classes = [IsStaffWith2FA]

    def get_queryset(self):
        qs = ComplianceFlag.objects.select_related("user").order_by("-created_at")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        flag = self.get_object()
        new_status = request.data.get("status")
        if new_status not in (ComplianceFlag.Status.CLEARED, ComplianceFlag.Status.ESCALATED):
            raise serializers.ValidationError({"status": "Must be 'cleared' or 'escalated'."})
        flag.status = new_status
        flag.notes = request.data.get("notes", flag.notes)
        flag.resolved_at = timezone.now()
        flag.save()
        return Response(ComplianceFlagSerializer(flag).data)


class AdminDashboardView(APIView):
    """Landing-page counts for the portal — the queues staff actually
    need to work through today, at a glance."""
    permission_classes = [IsStaffWith2FA]

    def get(self, request):
        return Response({
            "pending_kyc": KYCSubmission.objects.filter(status=KYCSubmission.Status.PENDING).count(),
            "giftcards_under_review": GiftCardSubmission.objects.filter(
                transaction__status=Transaction.Status.UNDER_REVIEW
            ).count(),
            "transactions_awaiting_settlement": Transaction.objects.filter(
                status=Transaction.Status.VERIFIED
            ).count(),
            "withdrawals_awaiting_review": Transaction.objects.filter(
                status=Transaction.Status.UNDER_REVIEW,
                transaction_type__in=[
                    Transaction.TransactionType.FIAT_PAYOUT,
                    Transaction.TransactionType.CRYPTO_WITHDRAWAL,
                ],
            ).count(),
            "loads_awaiting_confirmation": Transaction.objects.filter(
                status=Transaction.Status.UNDER_REVIEW,
                transaction_type=Transaction.TransactionType.WALLET_LOAD,
            ).count(),
            "giftcard_auto_payment_enabled": PaymentSettings.get().giftcard_auto_payment_enabled,
            "open_compliance_flags": ComplianceFlag.objects.filter(
                status__in=[ComplianceFlag.Status.OPEN, ComplianceFlag.Status.REVIEWING]
            ).count(),
            "total_users": User.objects.count(),
            "users_by_tier": {
                tier: User.objects.filter(kyc_tier=tier).count()
                for tier, _ in User.KYCTier.choices
            },
        })
