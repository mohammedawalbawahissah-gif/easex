import uuid
from django.conf import settings
from django.db import models

from apps.transactions.models import Transaction


class GiftCardBrand(models.Model):
    """
    A brand a user can sell (Amazon, Steam, ...). The catalog lives in the
    database, not in code: it is seeded by a migration (see catalog_data.py) and
    edited in Django admin, so adding a brand or a subcategory never needs a deploy.
    """

    class Category(models.TextChoices):
        SHOPPING = "shopping", "Shopping & retail"
        GAMING = "gaming", "Gaming"
        APPS_ENTERTAINMENT = "apps_entertainment", "Apps & entertainment"
        FASHION_BEAUTY = "fashion_beauty", "Fashion & beauty"
        FOOD_TRAVEL = "food_travel", "Food & travel"
        PREPAID = "prepaid", "Prepaid cards (Visa / Mastercard / Amex)"

    slug = models.SlugField(max_length=32, unique=True)
    name = models.CharField(max_length=60)
    category = models.CharField(max_length=24, choices=Category.choices)
    # Two-tone tile gradient — brand colour identity, not the real logo artwork.
    color_from = models.CharField(max_length=7, default="#565b6b")
    color_to = models.CharField(max_length=7, default="#7a8194")
    sort_order = models.PositiveIntegerField(default=1000, help_text="Lower shows first")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class GiftCardSubcategory(models.Model):
    """
    A specific kind of a brand's card — what the seller picks in the dropdown:
    the issuing country/currency and the card format ("USA · E-code",
    "UK · Physical", "USA · $100–$299"...). Cards only work in their home
    marketplace, and exchanges price each variant differently, so every
    subcategory has its own currency and its own rate.
    """

    class Format(models.TextChoices):
        PHYSICAL = "physical", "Physical card"
        ECODE = "ecode", "E-code / digital"
        ANY = "any", "Physical or e-code"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand = models.ForeignKey(GiftCardBrand, on_delete=models.CASCADE, related_name="subcategories")
    slug = models.SlugField(max_length=48)
    name = models.CharField(max_length=80, help_text='What the seller sees, e.g. "USA · E-code"')
    country = models.CharField(max_length=8, blank=True, help_text='ISO country code, "EU", or "GLOBAL"')
    currency = models.CharField(max_length=3, help_text="Currency the card is denominated in, e.g. USD")
    card_format = models.CharField(max_length=10, choices=Format.choices, default=Format.ANY)
    min_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    max_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    rate = models.DecimalField(
        max_digits=14,
        decimal_places=6,
        null=True,
        blank=True,
        help_text=(
            "GHS paid per 1 unit of the card's currency (e.g. 12.5 = GHS 12.50 for each USD). "
            "EMPTY = this subcategory is shown as unavailable until you set a rate."
        ),
    )
    rate_updated_at = models.DateTimeField(null=True, blank=True, editable=False)

    allow_auto_payment = models.BooleanField(
        default=True,
        help_text=(
            "Untick for high-risk cards (open-loop prepaid Visa/Mastercard/Amex). Those are never "
            "auto-credited or auto-paid-out; an admin must settle them by hand."
        ),
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=1000)
    help_text = models.CharField(max_length=200, blank=True, help_text="Shown to the seller under the dropdown")

    class Meta:
        ordering = ["brand__sort_order", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["brand", "slug"], name="unique_subcategory_slug_per_brand"),
            models.CheckConstraint(
                condition=models.Q(rate__isnull=True) | models.Q(rate__gt=0), name="giftcard_rate_positive"
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            previous = GiftCardSubcategory.objects.filter(pk=self.pk).values_list("rate", flat=True).first()
            if previous != self.rate:
                from django.utils import timezone

                self.rate_updated_at = timezone.now()
        elif self.rate is not None:
            from django.utils import timezone

            self.rate_updated_at = timezone.now()
        super().save(*args, **kwargs)

    @property
    def is_available(self) -> bool:
        return self.is_active and self.brand.is_active and self.rate is not None

    def __str__(self):
        return f"{self.brand.name} — {self.name} ({self.currency})"


class GiftCardSubmission(models.Model):
    """
    A user's submitted gift card, pending verification. Linked
    1:1 to a Transaction, which carries the actual money-movement
    state. This model holds the card-specific details the review
    queue needs.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.OneToOneField(
        Transaction, on_delete=models.PROTECT, related_name="giftcard_submission"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="giftcard_submissions"
    )
    # Brand slug + the exact subcategory sold. `brand` is kept as a plain string so
    # submissions from before the catalog existed (and any later-deleted brand) still display.
    brand = models.CharField(max_length=32)
    subcategory = models.ForeignKey(
        GiftCardSubcategory, on_delete=models.PROTECT, null=True, blank=True, related_name="submissions"
    )
    card_currency = models.CharField(
        max_length=3, default="GHS", help_text="Currency the card is denominated in; face/redeemed values are in this"
    )
    # The code itself, encrypted (Fernet) so a reviewer can redeem it. It is ERASED the moment the card is
    # approved or rejected, and by a scheduled sweep after GIFTCARD_CODE_RETENTION_DAYS. It is never
    # returned by any user-facing API; staff read it only through the audited reveal endpoint.
    card_code_encrypted = models.TextField(blank=True, default="")
    code_wiped_at = models.DateTimeField(null=True, blank=True)
    code_reveal_count = models.PositiveIntegerField(default=0)
    # Keyed fingerprint (HMAC) of the normalised code: enough to catch the same card sold twice, useless
    # for recovering the code. This is what remains after the encrypted code has been erased.
    card_code_hash = models.CharField(max_length=128, db_index=True)
    face_value = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Declared value, in card_currency"
    )
    offered_rate = models.DecimalField(
        max_digits=14,
        decimal_places=6,
        help_text=(
            "GHS paid per 1 unit of card_currency, locked from the subcategory at submission time. "
            "(Submissions from before subcategories existed used a 0.85 fraction of a GHS face value.)"
        ),
    )
    verified_value = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text=(
            "The confirmed GHS PAYOUT for this card (redeemed_value x offered_rate). "
            "Set by the server when a reviewer approves — never typed in directly."
        ),
    )
    redeemed_value = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="What the reviewer actually redeemed from the card, in the card's own value units",
    )
    redemption_reference = models.CharField(
        max_length=100, blank=True,
        help_text="Order / receipt / balance reference from the redemption, for audit",
    )
    redeemed_at = models.DateTimeField(null=True, blank=True)
    card_image = models.ImageField(upload_to="giftcards/%Y/%m/", null=True, blank=True)
    reviewer_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_giftcards",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["card_code_hash"])]

    def __str__(self):
        return f"{self.brand} card — {self.face_value} {self.card_currency} ({self.transaction.status})"


class GiftCardImage(models.Model):
    """
    Extra evidence beyond the single `card_image` above — a seller can
    attach more than one photo (front/back, a screenshot of a digital
    code, a receipt) or a short video/PDF instead of being limited to
    exactly one image. `card_image` is kept as-is for backward
    compatibility and still shown first in the review queue; this table
    holds everything additional. A generic FileField (not ImageField) so
    non-image media isn't rejected at the model layer.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(GiftCardSubmission, on_delete=models.CASCADE, related_name="gallery")
    file = models.FileField(upload_to="giftcards/gallery/%Y/%m/")
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return f"Gallery item for {self.submission_id}"
