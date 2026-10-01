import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.wallets.models import Wallet


class PaymentSettings(models.Model):
    """
    Single-row, admin-editable business rules for money movement. Kept in
    the database (not env vars or code) so an operator can flip a switch
    during an incident, or tune a threshold, without a redeploy.

    Every default is the conservative one: gift-card auto-payment is OFF,
    and the "how much can happen without a human" thresholds are 0, so
    nothing is automatic until someone consciously chooses a number.
    """

    # --- Kill switches -----------------------------------------------------
    loads_enabled = models.BooleanField(default=True)
    withdrawals_enabled = models.BooleanField(default=True)
    transfers_enabled = models.BooleanField(default=True)

    # --- Withdrawals ------------------------------------------------------
    withdrawal_auto_approve_max_ghs = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text=(
            "Withdrawals up to this GHS-equivalent value skip manual review and "
            "are sent straight away. 0 = every withdrawal waits for an admin."
        ),
    )

    # --- Gift card auto-payment ---------------------------------------------
    giftcard_auto_payment_enabled = models.BooleanField(
        default=False,
        help_text=(
            "When ON, approving a gift card (after the reviewer attests it was "
            "redeemed) credits the seller's wallet immediately — no separate "
            "'settle' click."
        ),
    )
    giftcard_auto_payout_max_ghs = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text=(
            "For sellers who opted in: gift card proceeds up to this amount are "
            "also sent on to their saved mobile money account automatically. "
            "0 = never auto-send (proceeds stay in the wallet)."
        ),
    )
    auto_payout_destination_cooldown_hours = models.PositiveIntegerField(
        default=24,
        help_text=(
            "A newly saved payout account can't receive AUTOMATIC payouts until "
            "this many hours have passed. Blunts account-takeover cash-outs."
        ),
    )

    # --- Wallet loading -----------------------------------------------------
    manual_deposit_instructions = models.TextField(
        blank=True,
        help_text=(
            "Shown to a user who loads their wallet when no payment gateway is "
            "connected (e.g. 'Send to MTN MoMo 024XXXXXXX, name Wolbi …'). The "
            "user's load reference is appended automatically."
        ),
    )
    bank_transfer_instructions = models.TextField(
        blank=True,
        help_text=(
            "Shown to a user who chooses 'Bank transfer' to load their wallet "
            "(e.g. account name/number/bank/branch). The user's load reference "
            "is appended automatically so staff can match the deposit. Editable "
            "here without a redeploy — update this the moment the company bank "
            "account changes."
        ),
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Payment settings"
        verbose_name_plural = "Payment settings"

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce a single row
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # never deletable

    @classmethod
    def get(cls) -> "PaymentSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Payment settings"


class PayoutDestination(models.Model):
    """A saved place to send the user's GHS (mobile money or a bank account)."""

    class Kind(models.TextChoices):
        MOBILE_MONEY = "mobile_money", "Mobile money"
        BANK = "bank", "Bank account"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="payout_destinations"
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MOBILE_MONEY)
    # Mobile money: "mtn" / "telecel" / "airteltigo". Bank: not used.
    network = models.CharField(max_length=20, blank=True, help_text="mtn / telecel / airteltigo (mobile money only)")
    account_number = models.CharField(max_length=30, help_text="Mobile money number, or bank account number")
    account_name = models.CharField(max_length=100, help_text="Name the user gave for this account")
    # Bank-only fields. Left blank for mobile money destinations.
    bank_name = models.CharField(max_length=100, blank=True, help_text="Bank name (bank destinations only)")
    bank_branch = models.CharField(max_length=100, blank=True, help_text="Branch, if the user provided one")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "kind", "network", "account_number"],
                condition=models.Q(is_active=True),
                name="unique_active_payout_destination",
            )
        ]

    def as_snapshot(self) -> dict:
        """What gets copied onto a withdrawal, so history survives edits/deletes."""
        return {
            "kind": self.kind,
            "network": self.network,
            "account_number": self.account_number,
            "account_name": self.account_name,
            "bank_name": self.bank_name,
            "bank_branch": self.bank_branch,
        }

    def __str__(self):
        if self.kind == self.Kind.BANK:
            return f"{self.bank_name} {self.account_number} ({self.user})"
        return f"{self.network} {self.account_number} ({self.user})"


class PayoutPreference(models.Model):
    """Per-user opt-in for automatic payout of gift card proceeds."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="payout_preference"
    )
    auto_payout_enabled = models.BooleanField(default=False)
    destination = models.ForeignKey(
        PayoutDestination, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user} auto-payout {'on' if self.auto_payout_enabled else 'off'}"


class DepositAddress(models.Model):
    """A stable on-chain deposit address issued to a user for one asset+network."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deposit_addresses"
    )
    currency = models.CharField(max_length=10, choices=Wallet.Currency.choices)
    network = models.CharField(max_length=20)
    address = models.CharField(max_length=200)
    memo = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "currency", "network"], name="unique_deposit_address_per_asset"
            )
        ]

    def __str__(self):
        return f"{self.currency}/{self.network} for {self.user}"


class ScheduledTransfer(models.Model):
    """
    A transfer to another EaseX user that runs at a future time.

    Funds are NOT reserved when it is scheduled (same as a bank standing
    order): the balance is checked when it runs, and if it isn't there the
    transfer fails and the user is told. Reserving would lock money for
    weeks and stop the user spending it.
    """

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="scheduled_transfers"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="incoming_scheduled_transfers"
    )
    currency = models.CharField(max_length=10, choices=Wallet.Currency.choices)
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    note = models.CharField(max_length=140, blank=True)
    run_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    failure_reason = models.CharField(max_length=200, blank=True)
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="The sender-side transaction, once it has run",
    )
    idempotency_key = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["run_at"]
        indexes = [models.Index(fields=["status", "run_at"])]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="scheduled_transfer_amount_positive"),
        ]

    @property
    def is_due(self) -> bool:
        return self.status == self.Status.SCHEDULED and self.run_at <= timezone.now()

    def __str__(self):
        return f"{self.amount} {self.currency} → {self.recipient} at {self.run_at:%Y-%m-%d %H:%M} ({self.status})"


class ScheduledLoad(models.Model):
    """
    A mobile-money wallet top-up that runs at a future time.

    Same philosophy as ScheduledTransfer: nothing is charged when it's
    scheduled. At run time we simply call the normal load flow, which
    prompts the user's phone for payment — so "loading" here means
    starting the collection request, not guaranteeing money appears.
    """

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="scheduled_loads"
    )
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    network = models.CharField(max_length=20)
    phone_number = models.CharField(max_length=20)
    run_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    failure_reason = models.CharField(max_length=200, blank=True)
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="The wallet-load transaction, once it has run",
    )
    idempotency_key = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["run_at"]
        indexes = [models.Index(fields=["status", "run_at"])]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="scheduled_load_amount_positive"),
        ]

    @property
    def is_due(self) -> bool:
        return self.status == self.Status.SCHEDULED and self.run_at <= timezone.now()

    def __str__(self):
        return f"{self.amount} GHS load at {self.run_at:%Y-%m-%d %H:%M} ({self.status})"


class ScheduledWithdrawal(models.Model):
    """
    A withdrawal (mobile money or crypto) that runs at a future time.

    Like ScheduledTransfer, funds are NOT held when this is scheduled —
    only when it actually runs, via the normal `request_withdrawal` flow.
    """

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="scheduled_withdrawals"
    )
    currency = models.CharField(max_length=10, choices=Wallet.Currency.choices)
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    destination = models.ForeignKey(
        PayoutDestination,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="GHS withdrawals only.",
    )
    address = models.CharField(max_length=200, blank=True, help_text="Crypto withdrawals only.")
    network = models.CharField(max_length=20, blank=True)
    memo = models.CharField(max_length=40, blank=True)
    run_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    failure_reason = models.CharField(max_length=200, blank=True)
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="The withdrawal transaction, once it has run",
    )
    idempotency_key = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["run_at"]
        indexes = [models.Index(fields=["status", "run_at"])]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="scheduled_withdrawal_amount_positive"),
        ]

    @property
    def is_due(self) -> bool:
        return self.status == self.Status.SCHEDULED and self.run_at <= timezone.now()

    def __str__(self):
        return f"{self.amount} {self.currency} withdrawal at {self.run_at:%Y-%m-%d %H:%M} ({self.status})"
