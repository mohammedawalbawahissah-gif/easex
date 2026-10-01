from django.utils import timezone
from rest_framework import serializers

from apps.wallets.models import Wallet

from .currencies import MOBILE_MONEY_NETWORKS, PAYMENT_METHODS
from .models import (
    DepositAddress,
    PayoutDestination,
    PayoutPreference,
    ScheduledLoad,
    ScheduledTransfer,
    ScheduledWithdrawal,
)

CURRENCY_CHOICES = [c for c, _ in Wallet.Currency.choices]
KEY_REGEX = r"^[A-Za-z0-9_\-]{8,40}$"


class PasswordConfirmMixin(serializers.Serializer):
    """Account-level changes (payout accounts, auto-payout) re-ask for the password (+ 2FA code if on)."""

    password = serializers.CharField(write_only=True, trim_whitespace=False)
    otp = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=16)


class PinConfirmMixin(serializers.Serializer):
    """Money-moving requests are confirmed with the 6-digit transaction PIN."""

    # allow_blank: a user with no PIN yet should hear "set your PIN" (pin_not_set), not a generic field error.
    pin = serializers.CharField(write_only=True, allow_blank=True, trim_whitespace=False, max_length=12)
    otp = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=16)


class IdempotentMixin(serializers.Serializer):
    idempotency_key = serializers.RegexField(KEY_REGEX)


class LoadWalletSerializer(IdempotentMixin):
    amount = serializers.DecimalField(max_digits=20, decimal_places=8)
    network = serializers.ChoiceField(choices=list(PAYMENT_METHODS))
    # Not needed when network="bank" — the bank-transfer flow just shows
    # the user EaseX's account details, so no phone number is collected.
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate(self, data):
        if data["network"] != "bank" and not data.get("phone_number"):
            raise serializers.ValidationError({"phone_number": "Enter a valid Ghana mobile money number."})
        return data


class ScheduleLoadSerializer(LoadWalletSerializer):
    # Scheduled/recurring loads stay mobile-money only for now — a
    # "scheduled bank transfer" has nothing to actually trigger at the
    # scheduled time beyond a reminder, so it isn't wired into the
    # scheduler (see services.schedule_wallet_load).
    network = serializers.ChoiceField(choices=list(MOBILE_MONEY_NETWORKS))
    phone_number = serializers.CharField(max_length=20)
    run_at = serializers.DateTimeField()

    def validate_run_at(self, value):
        if timezone.is_naive(value):
            raise serializers.ValidationError("Include a timezone.")
        return value


class ScheduledLoadSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduledLoad
        fields = [
            "id", "amount", "network", "phone_number", "run_at",
            "status", "failure_reason", "transaction", "created_at", "executed_at",
        ]
        read_only_fields = fields


class WithdrawSerializer(PinConfirmMixin, IdempotentMixin):
    currency = serializers.ChoiceField(choices=CURRENCY_CHOICES)
    amount = serializers.DecimalField(max_digits=20, decimal_places=8)
    destination_id = serializers.UUIDField(required=False, allow_null=True)
    address = serializers.CharField(required=False, allow_blank=True, max_length=200)
    network = serializers.CharField(required=False, allow_blank=True, max_length=20)
    memo = serializers.CharField(required=False, allow_blank=True, max_length=40)


class ScheduleWithdrawSerializer(WithdrawSerializer):
    run_at = serializers.DateTimeField()

    def validate_run_at(self, value):
        if timezone.is_naive(value):
            raise serializers.ValidationError("Include a timezone.")
        return value


class ScheduledWithdrawalSerializer(serializers.ModelSerializer):
    destination_id = serializers.UUIDField(source="destination.id", read_only=True, default=None)

    class Meta:
        model = ScheduledWithdrawal
        fields = [
            "id", "currency", "amount", "destination_id", "address", "network", "memo", "run_at",
            "status", "failure_reason", "transaction", "created_at", "executed_at",
        ]
        read_only_fields = fields


class TransferLookupSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=150)


class TransferSerializer(PinConfirmMixin, IdempotentMixin):
    recipient = serializers.CharField(max_length=150)
    currency = serializers.ChoiceField(choices=CURRENCY_CHOICES)
    amount = serializers.DecimalField(max_digits=20, decimal_places=8)
    note = serializers.CharField(required=False, allow_blank=True, max_length=140)


class ScheduleTransferSerializer(TransferSerializer):
    run_at = serializers.DateTimeField()

    def validate_run_at(self, value):
        if timezone.is_naive(value):
            raise serializers.ValidationError("Include a timezone.")
        return value


class ScheduledTransferSerializer(serializers.ModelSerializer):
    recipient_username = serializers.CharField(source="recipient.username", read_only=True)

    class Meta:
        model = ScheduledTransfer
        fields = [
            "id", "recipient_username", "currency", "amount", "note", "run_at",
            "status", "failure_reason", "transaction", "created_at", "executed_at",
        ]
        read_only_fields = fields


class PayoutDestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayoutDestination
        fields = [
            "id", "kind", "network", "account_number", "account_name",
            "bank_name", "bank_branch", "created_at",
        ]
        read_only_fields = fields


class CreateDestinationSerializer(PasswordConfirmMixin):
    kind = serializers.ChoiceField(choices=PayoutDestination.Kind.choices, default=PayoutDestination.Kind.MOBILE_MONEY)
    network = serializers.ChoiceField(choices=list(MOBILE_MONEY_NETWORKS), required=False, allow_blank=True)
    account_number = serializers.CharField(max_length=30)
    account_name = serializers.CharField(max_length=100)
    bank_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    bank_branch = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate(self, data):
        if data.get("kind") == PayoutDestination.Kind.BANK:
            if not data.get("bank_name"):
                raise serializers.ValidationError({"bank_name": "Enter the bank name."})
        elif not data.get("network"):
            raise serializers.ValidationError({"network": "Choose a mobile money network."})
        return data


class PayoutPreferenceSerializer(serializers.ModelSerializer):
    destination_id = serializers.UUIDField(source="destination.id", read_only=True, default=None)

    class Meta:
        model = PayoutPreference
        fields = ["auto_payout_enabled", "destination_id", "updated_at"]
        read_only_fields = fields


class UpdatePayoutPreferenceSerializer(PasswordConfirmMixin):
    auto_payout_enabled = serializers.BooleanField()
    destination_id = serializers.UUIDField(required=False, allow_null=True)


class DepositAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = DepositAddress
        fields = ["currency", "network", "address", "memo"]
        read_only_fields = fields
