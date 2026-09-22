from django.contrib.auth import get_user_model
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.transactions.serializers import TransactionSerializer

from apps.security import services as security
from apps.security.services import SecurityError
from apps.security.views import security_error_response

from . import limits, services
from .currencies import (
    CRYPTO_NETWORKS,
    FIAT_CURRENCY,
    MEMO_NETWORKS,
    MOBILE_MONEY_NETWORKS,
    NETWORK_LABELS,
)
from .models import (
    PaymentSettings,
    PayoutDestination,
    PayoutPreference,
    ScheduledLoad,
    ScheduledTransfer,
    ScheduledWithdrawal,
)
from .serializers import (
    CreateDestinationSerializer,
    DepositAddressSerializer,
    LoadWalletSerializer,
    PayoutDestinationSerializer,
    PayoutPreferenceSerializer,
    ScheduledLoadSerializer,
    ScheduledTransferSerializer,
    ScheduledWithdrawalSerializer,
    ScheduleLoadSerializer,
    ScheduleTransferSerializer,
    ScheduleWithdrawSerializer,
    TransferLookupSerializer,
    TransferSerializer,
    UpdatePayoutPreferenceSerializer,
    WithdrawSerializer,
)
from .services import PaymentError

User = get_user_model()


class PaymentView(APIView):
    """Base: authenticated, tightly throttled, PaymentError -> 400 {detail, code}."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    write_scope = "money"  # subclasses pick a tighter scope for writes

    def initial(self, request, *args, **kwargs):
        # Looking at your own data shouldn't burn the tight budget that
        # exists to slow down password guessing on money-moving calls.
        self.throttle_scope = "money" if request.method in ("GET", "HEAD", "OPTIONS") else self.write_scope
        super().initial(request, *args, **kwargs)

    def handle_exception(self, exc):
        if isinstance(exc, PaymentError):
            return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)
        if isinstance(exc, SecurityError):
            return security_error_response(exc)
        return super().handle_exception(exc)

    def confirm_password(self, request, data):
        """Account-level changes: password, plus a 2FA code if the account has 2FA on."""
        security.verify_password(request.user, data["password"])
        security.require_otp_if_enabled(request.user, data.get("otp"))

    def confirm_pin(self, request, data, *, require_otp: bool = False):
        """Moving money: the transaction PIN. External withdrawals also need a 2FA code when 2FA is on."""
        security.verify_pin(request.user, data["pin"])
        if require_otp:
            security.require_otp_if_enabled(request.user, data.get("otp"))


def _txn_response(txn, created):
    return Response(TransactionSerializer(txn).data, status=201 if created else 200)


class PaymentConfigView(APIView):
    """Everything a client needs to draw the money screens: rules, limits, networks."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        ps = PaymentSettings.get()
        user = request.user
        return Response(
            {
                "fiat_currency": FIAT_CURRENCY,
                "mobile_money_networks": [{"value": k, "label": v} for k, v in MOBILE_MONEY_NETWORKS.items()],
                "crypto_networks": {
                    cur: [{"value": n, "label": NETWORK_LABELS[n], "needs_memo": n in MEMO_NETWORKS} for n in nets]
                    for cur, nets in CRYPTO_NETWORKS.items()
                },
                "daily_limit_ghs": str(user.daily_limit()),
                "outgoing_remaining_ghs": str(limits.outgoing_remaining(user)),
                "loads_remaining_ghs": str(limits.loads_remaining(user)),
                "loads_enabled": ps.loads_enabled,
                "withdrawals_enabled": ps.withdrawals_enabled,
                "transfers_enabled": ps.transfers_enabled,
                "auto_approve_withdrawals_up_to_ghs": str(ps.withdrawal_auto_approve_max_ghs),
                "giftcard_auto_payment_enabled": ps.giftcard_auto_payment_enabled,
                "giftcard_auto_payout_max_ghs": str(ps.giftcard_auto_payout_max_ghs),
                "auto_payout_cooldown_hours": ps.auto_payout_destination_cooldown_hours,
            }
        )


class LoadWalletView(PaymentView):
    write_scope = "money_in"

    def post(self, request):
        s = LoadWalletSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        txn, created = services.create_wallet_load(
            user=request.user,
            amount=d["amount"],
            network=d["network"],
            phone_number=d["phone_number"],
            idempotency_key=d["idempotency_key"],
        )
        return _txn_response(txn, created)


class DepositAddressView(PaymentView):
    write_scope = "money_in"

    def get(self, request):
        addr = services.get_deposit_address(
            user=request.user,
            currency=request.query_params.get("currency", ""),
            network=request.query_params.get("network", ""),
        )
        return Response(DepositAddressSerializer(addr).data)


class WithdrawView(PaymentView):
    write_scope = "money_out"

    def post(self, request):
        s = WithdrawSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_pin(request, d, require_otp=True)
        txn, created = services.request_withdrawal(
            user=request.user,
            currency=d["currency"],
            amount=d["amount"],
            idempotency_key=d["idempotency_key"],
            destination_id=d.get("destination_id"),
            address=d.get("address", ""),
            network=d.get("network", ""),
            memo=d.get("memo", ""),
        )
        return _txn_response(txn, created)


class ScheduledLoadListCreateView(PaymentView):
    write_scope = "money_in"

    def get(self, request):
        qs = ScheduledLoad.objects.filter(user=request.user).order_by("-run_at")
        return Response(ScheduledLoadSerializer(qs, many=True).data)

    def post(self, request):
        s = ScheduleLoadSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        obj, created = services.schedule_wallet_load(
            user=request.user,
            amount=d["amount"],
            network=d["network"],
            phone_number=d["phone_number"],
            run_at=d["run_at"],
            idempotency_key=d["idempotency_key"],
        )
        return Response(ScheduledLoadSerializer(obj).data, status=201 if created else 200)


class ScheduledLoadCancelView(PaymentView):
    def post(self, request, pk):
        obj = services.cancel_scheduled_load(user=request.user, scheduled_id=pk)
        return Response(ScheduledLoadSerializer(obj).data)


class ScheduledWithdrawalListCreateView(PaymentView):
    write_scope = "money_out"

    def get(self, request):
        qs = ScheduledWithdrawal.objects.filter(user=request.user).order_by("-run_at")
        return Response(ScheduledWithdrawalSerializer(qs, many=True).data)

    def post(self, request):
        s = ScheduleWithdrawSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_pin(request, d, require_otp=True)
        obj, created = services.schedule_withdrawal(
            user=request.user,
            currency=d["currency"],
            amount=d["amount"],
            run_at=d["run_at"],
            idempotency_key=d["idempotency_key"],
            destination_id=d.get("destination_id"),
            address=d.get("address", ""),
            network=d.get("network", ""),
            memo=d.get("memo", ""),
        )
        return Response(ScheduledWithdrawalSerializer(obj).data, status=201 if created else 200)


class ScheduledWithdrawalCancelView(PaymentView):
    def post(self, request, pk):
        obj = services.cancel_scheduled_withdrawal(user=request.user, scheduled_id=pk)
        return Response(ScheduledWithdrawalSerializer(obj).data)


class TransferLookupView(PaymentView):
    """
    Lets the sender confirm WHO they're paying before they commit. Returns
    only a masked username, and is tightly throttled, so it can't be used
    to harvest which phone numbers belong to EaseX users.
    """

    write_scope = "lookup"

    def post(self, request):
        s = TransferLookupSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = services.find_recipient(s.validated_data["identifier"], exclude=request.user)
        if not user:
            raise PaymentError("We couldn't find that person. Check the username or phone number.", "recipient_not_found")
        return Response({"display_name": services.mask_username(user.username)})


class TransferView(PaymentView):
    write_scope = "money_out"

    def post(self, request):
        s = TransferSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_pin(request, d)
        recipient = services.find_recipient(d["recipient"], exclude=request.user)
        txn, created = services.execute_transfer(
            sender=request.user,
            recipient=recipient,
            currency=d["currency"],
            amount=d["amount"],
            note=d.get("note", ""),
            idempotency_key=d["idempotency_key"],
        )
        return _txn_response(txn, created)


class ScheduledTransferListCreateView(PaymentView):
    write_scope = "money_out"

    def get(self, request):
        qs = ScheduledTransfer.objects.filter(user=request.user).select_related("recipient").order_by("-run_at")
        return Response(ScheduledTransferSerializer(qs, many=True).data)

    def post(self, request):
        s = ScheduleTransferSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_pin(request, d)
        recipient = services.find_recipient(d["recipient"], exclude=request.user)
        obj, created = services.schedule_transfer(
            user=request.user,
            recipient=recipient,
            currency=d["currency"],
            amount=d["amount"],
            run_at=d["run_at"],
            note=d.get("note", ""),
            idempotency_key=d["idempotency_key"],
        )
        return Response(ScheduledTransferSerializer(obj).data, status=201 if created else 200)


class ScheduledTransferCancelView(PaymentView):
    def post(self, request, pk):
        obj = services.cancel_scheduled_transfer(user=request.user, scheduled_id=pk)
        return Response(ScheduledTransferSerializer(obj).data)


class PayoutDestinationListCreateView(PaymentView):
    write_scope = "money_out"

    def get(self, request):
        qs = PayoutDestination.objects.filter(user=request.user, is_active=True)
        return Response(PayoutDestinationSerializer(qs, many=True).data)

    def post(self, request):
        s = CreateDestinationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_password(request, d)
        dest = services.add_destination(
            user=request.user,
            network=d["network"],
            account_number=d["account_number"],
            account_name=d["account_name"],
        )
        return Response(PayoutDestinationSerializer(dest).data, status=201)


class PayoutDestinationDetailView(PaymentView):
    write_scope = "money_out"

    def delete(self, request, pk):
        services.remove_destination(user=request.user, destination_id=pk)
        return Response(status=204)


class PayoutPreferenceView(PaymentView):
    write_scope = "money_out"

    def get(self, request):
        pref, _ = PayoutPreference.objects.get_or_create(user=request.user)
        return Response(PayoutPreferenceSerializer(pref).data)

    def put(self, request):
        s = UpdatePayoutPreferenceSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self.confirm_password(request, d)
        pref = services.set_auto_payout(
            user=request.user, enabled=d["auto_payout_enabled"], destination_id=d.get("destination_id")
        )
        return Response(PayoutPreferenceSerializer(pref).data)
