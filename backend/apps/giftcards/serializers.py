import uuid
from decimal import Decimal

from rest_framework import serializers

from apps.transactions.models import Transaction
from apps.wallets.models import Wallet

from apps.security import crypto

from . import services
from .models import GiftCardBrand, GiftCardImage, GiftCardSubcategory, GiftCardSubmission


# ---------------------------------------------------------------------------
# Catalog (what the sell screen shows)
# ---------------------------------------------------------------------------


class SubcategorySerializer(serializers.ModelSerializer):
    # A subcategory without a rate is listed but can't be chosen — the seller sees
    # "unavailable" instead of the brand silently missing or a wrong payout.
    available = serializers.SerializerMethodField()

    class Meta:
        model = GiftCardSubcategory
        fields = [
            "id", "slug", "name", "country", "currency", "card_format",
            "min_value", "max_value", "rate", "available", "help_text",
        ]
        read_only_fields = fields

    def get_available(self, obj):
        return obj.rate is not None


class BrandSerializer(serializers.ModelSerializer):
    subcategories = serializers.SerializerMethodField()

    class Meta:
        model = GiftCardBrand
        fields = ["slug", "name", "category", "category_label", "color_from", "color_to", "subcategories"]
        read_only_fields = fields

    category_label = serializers.CharField(source="get_category_display", read_only=True)

    def get_subcategories(self, obj):
        # Uses the prefetched, already-active list set by the view.
        return SubcategorySerializer(obj.active_subcategories, many=True).data


# ---------------------------------------------------------------------------
# Submissions
# ---------------------------------------------------------------------------


class AdminGiftCardSubmissionSerializer(serializers.ModelSerializer):
    """
    Staff-facing view — includes who submitted it and the real
    Transaction status, but never card_code_hash (nothing to gain
    from exposing it, even to staff).
    """
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)
    transaction_status = serializers.CharField(source="transaction.status", read_only=True)
    auto_payment = serializers.SerializerMethodField()
    brand_name = serializers.SerializerMethodField()
    subcategory_name = serializers.CharField(source="subcategory.name", read_only=True, default=None)
    country = serializers.CharField(source="subcategory.country", read_only=True, default="")
    card_format = serializers.CharField(source="subcategory.card_format", read_only=True, default="")
    subcategory_help = serializers.CharField(source="subcategory.help_text", read_only=True, default="")
    # Whether a reveal is possible — NEVER the code itself (that only comes from the audited reveal endpoint).
    code_available = serializers.SerializerMethodField()
    gallery = serializers.SerializerMethodField()

    class Meta:
        model = GiftCardSubmission
        fields = [
            "id", "user", "username", "email", "brand", "brand_name", "subcategory",
            "subcategory_name", "country", "card_format", "subcategory_help", "card_currency",
            "face_value", "offered_rate",
            "verified_value", "redeemed_value", "redemption_reference", "redeemed_at",
            "card_image", "gallery", "reviewer_notes", "reviewed_by", "reviewed_at",
            "submitted_at", "transaction", "transaction_status", "auto_payment",
            "code_available", "code_reveal_count", "code_wiped_at",
        ]
        read_only_fields = fields

    def get_code_available(self, obj):
        return bool(obj.card_code_encrypted)

    def get_gallery(self, obj):
        request = self.context.get("request")
        items = []
        for img in obj.gallery.all():
            url = img.file.url
            items.append({
                "id": str(img.id),
                "url": request.build_absolute_uri(url) if request else url,
                "content_type": img.content_type,
            })
        return items

    def get_brand_name(self, obj):
        return services.brand_display_name(obj)

    def get_auto_payment(self, obj):
        """What automatic payment did (or didn't do) when this was approved."""
        return (obj.transaction.metadata or {}).get("auto_payment")


class GiftCardSubmissionSerializer(serializers.ModelSerializer):
    card_code = serializers.CharField(write_only=True)
    # The seller picks a subcategory; everything else about the card type (brand,
    # currency, rate, allowed value range) is read from it on the server.
    subcategory = serializers.PrimaryKeyRelatedField(
        queryset=GiftCardSubcategory.objects.select_related("brand")
    )
    brand_name = serializers.SerializerMethodField()
    subcategory_name = serializers.CharField(source="subcategory.name", read_only=True, default=None)
    # The real status lives on the linked Transaction (pending → under_review
    # → verified → settled/rejected/flagged). Exposing it here means the
    # frontend shows the truth instead of guessing or hardcoding "pending".
    transaction_status = serializers.CharField(source="transaction.status", read_only=True)
    estimated_payout = serializers.SerializerMethodField()
    # Extra evidence beyond the single card_image — any number of images,
    # a short video, or a PDF (receipt, screenshot, etc). Write-only in;
    # `gallery` is the read-only view of what actually got stored.
    images = serializers.ListField(
        child=serializers.FileField(), write_only=True, required=False, allow_empty=True
    )
    gallery = serializers.SerializerMethodField()

    class Meta:
        model = GiftCardSubmission
        fields = [
            "id", "brand", "brand_name", "subcategory", "subcategory_name", "card_currency",
            "card_code", "face_value", "offered_rate", "estimated_payout",
            "verified_value", "card_image", "images", "gallery", "submitted_at",
            "transaction", "transaction_status",
        ]
        # brand, currency and rate are decided by the server from the chosen subcategory.
        # (offered_rate used to be accepted from the client, so anyone could submit a
        # 100 card "at 500%".)
        read_only_fields = [
            "id", "brand", "card_currency", "offered_rate", "verified_value", "submitted_at",
            "transaction", "transaction_status",
        ]
        extra_kwargs = {"face_value": {"min_value": Decimal("0.01")}}

    def get_brand_name(self, obj):
        return services.brand_display_name(obj)

    def get_estimated_payout(self, obj):
        return str(services.payout_for(obj.face_value, obj.offered_rate))

    def get_gallery(self, obj):
        request = self.context.get("request")
        items = []
        for img in obj.gallery.all():
            url = img.file.url
            items.append({
                "id": str(img.id),
                "url": request.build_absolute_uri(url) if request else url,
                "content_type": img.content_type,
            })
        return items

    def validate(self, attrs):
        sub = attrs["subcategory"]
        if not sub.is_active or not sub.brand.is_active:
            raise serializers.ValidationError({"subcategory": "We're not accepting this card type right now."})
        if sub.rate is None:
            raise serializers.ValidationError({"subcategory": "This card type isn't available right now."})
        value = attrs["face_value"]
        if sub.min_value is not None and value < sub.min_value:
            raise serializers.ValidationError(
                {"face_value": f"The minimum for this card type is {sub.min_value} {sub.currency}."}
            )
        if sub.max_value is not None and value > sub.max_value:
            raise serializers.ValidationError(
                {"face_value": f"The maximum for this card type is {sub.max_value} {sub.currency}."}
            )
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        card_code = validated_data.pop("card_code")
        images = validated_data.pop("images", [])
        if len(images) > 6:
            raise serializers.ValidationError({"images": "Up to 6 files."})
        sub = validated_data["subcategory"]
        # Normalised, so "ABCD-1234", "abcd1234" and "ABCD 1234" are the
        # same card. Legacy (un-normalised) hashes are checked too.
        code_hash, legacy_hash = services.card_code_hashes(card_code)
        if not services.normalize_card_code(card_code):
            raise serializers.ValidationError("Enter the card code.")

        # Duplicate-code check — a repeated hash is a strong fraud signal.
        if GiftCardSubmission.objects.filter(card_code_hash__in=[code_hash, *legacy_hash]).exists():
            raise serializers.ValidationError(
                "This gift card has already been submitted."
            )

        # Locked from the subcategory NOW, so a rate change while the card waits for
        # review can't change what this seller was promised.
        validated_data["brand"] = sub.brand.slug
        validated_data["card_currency"] = sub.currency
        validated_data["offered_rate"] = sub.rate
        wallet, _ = Wallet.objects.get_or_create(user=user, currency=Wallet.Currency.GHS)
        estimated_payout = services.payout_for(validated_data["face_value"], sub.rate)
        if estimated_payout <= 0:
            raise serializers.ValidationError({"face_value": "That amount is too small to pay out."})

        transaction = Transaction.objects.create(
            user=user,
            wallet=wallet,
            transaction_type=Transaction.TransactionType.GIFTCARD_SALE,
            status=Transaction.Status.UNDER_REVIEW,
            amount=estimated_payout,
            currency=Wallet.Currency.GHS,
            idempotency_key=str(uuid.uuid4()),
        )

        submission = GiftCardSubmission.objects.create(
            transaction=transaction,
            user=user,
            card_code_hash=code_hash,
            card_code_encrypted=crypto.encrypt(card_code.strip()),
            **validated_data,
        )
        for f in images:
            GiftCardImage.objects.create(submission=submission, file=f, content_type=getattr(f, "content_type", "") or "")
        return submission
