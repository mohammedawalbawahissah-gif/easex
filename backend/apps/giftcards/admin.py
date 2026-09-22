from django.contrib import admin

from . import services
from .models import GiftCardBrand, GiftCardImage, GiftCardSubcategory, GiftCardSubmission


SWITCH_OFF_NOTE = (
    "To stop selling something, untick \u201cIs active\u201d. Deleting is disabled here on purpose: a deleted "
    "subcategory loses its rate, and deleting a brand deletes every subcategory (and price) under it."
)


class NoDeleteMixin:
    """
    Catalog entries can be switched off, never deleted, in admin. Deleting one throws away its rate, and
    deleting a brand cascades to every subcategory under it. The usual way it happens by accident is the
    "Delete?" tick-box that Django puts on every inline row when you save a brand.
    (If you genuinely need one gone, do it deliberately from `manage.py shell`.)
    """

    def has_delete_permission(self, request, obj=None):
        return False


class SubcategoryInline(NoDeleteMixin, admin.TabularInline):
    model = GiftCardSubcategory
    can_delete = False  # removes the per-row "Delete?" checkbox
    extra = 0
    fields = ["name", "slug", "country", "currency", "card_format", "rate", "min_value", "max_value", "allow_auto_payment", "is_active"]
    show_change_link = True


@admin.register(GiftCardBrand)
class GiftCardBrandAdmin(NoDeleteMixin, admin.ModelAdmin):
    """Add a brand here and it appears on the sell screen — no deploy needed."""
    list_display = ["name", "slug", "category", "sort_order", "is_active", "sellable_subcategories"]
    list_editable = ["sort_order", "is_active"]
    list_filter = ["category", "is_active"]
    search_fields = ["name", "slug"]
    prepopulated_fields = {"slug": ("name",)}
    fieldsets = [
        (None, {
            "fields": ["name", "slug", "category", "color_from", "color_to", "sort_order", "is_active"],
            "description": SWITCH_OFF_NOTE,
        })
    ]
    inlines = [SubcategoryInline]

    @admin.display(description="Sellable subcategories")
    def sellable_subcategories(self, obj):
        total = obj.subcategories.count()
        ready = obj.subcategories.filter(is_active=True, rate__isnull=False).count()
        return f"{ready} of {total} have a rate"


@admin.register(GiftCardSubcategory)
class GiftCardSubcategoryAdmin(NoDeleteMixin, admin.ModelAdmin):
    """
    The pricing sheet. Edit the Rate column directly in the list (GHS per 1 unit of the
    card's currency). A subcategory with no rate shows as unavailable to sellers.
    """
    list_display = [
        "brand", "name", "currency", "card_format", "rate", "rate_updated_at",
        "allow_auto_payment", "is_active",
    ]
    list_editable = ["rate", "is_active"]
    list_filter = ["brand", "currency", "card_format", "allow_auto_payment", "is_active", ("rate", admin.EmptyFieldListFilter)]
    search_fields = ["name", "brand__name", "country"]
    list_select_related = ["brand"]
    list_per_page = 100
    ordering = ["brand__sort_order", "sort_order"]
    readonly_fields = ["rate_updated_at"]
    fieldsets = [
        (None, {
            "fields": [
                "brand", "name", "slug", "country", "currency", "card_format", "min_value", "max_value",
                "rate", "rate_updated_at", "allow_auto_payment", "is_active", "sort_order", "help_text",
            ],
            "description": SWITCH_OFF_NOTE,
        })
    ]


class GiftCardImageInline(admin.TabularInline):
    model = GiftCardImage
    extra = 0
    fields = ["file", "content_type", "uploaded_at"]
    readonly_fields = ["uploaded_at"]


@admin.register(GiftCardSubmission)
class GiftCardSubmissionAdmin(admin.ModelAdmin):
    """This IS the fraud/manual-review queue — the most important
    admin screen in the app. Verified cards' status filter lets
    reviewers work through a real backlog efficiently."""
    inlines = [GiftCardImageInline]
    list_display = [
        "id", "user", "brand", "subcategory", "face_value", "card_currency", "offered_rate",
        "verified_value", "transaction_status", "submitted_at",
    ]
    list_filter = ["brand", "card_currency", "transaction__status"]
    search_fields = ["user__username", "card_code_hash"]
    list_select_related = ["user", "subcategory__brand", "transaction"]
    # The encrypted code is never displayed here: Django admin has no reveal audit or 2FA step.
    exclude = ["card_code_encrypted"]
    readonly_fields = [
        "card_code_hash", "submitted_at", "transaction", "brand", "subcategory", "card_currency",
        "offered_rate", "verified_value", "redeemed_value", "redemption_reference", "redeemed_at",
        "code_wiped_at", "code_reveal_count",
    ]
    actions = ["reject_cards"]

    # There is deliberately NO bulk "approve" action here. Approval means
    # "I redeemed this card and here is what it was worth", which can only
    # be attested one card at a time — use the staff portal. (A bulk approve
    # that assumed the declared value would pay out unverified cards, and
    # with auto-payment on, would send that money on to the seller.)

    def transaction_status(self, obj):
        return obj.transaction.status
    transaction_status.short_description = "Status"

    @admin.action(description="Reject selected cards")
    def reject_cards(self, request, queryset):
        for submission in queryset:
            try:
                services.reject_submission(submission.pk, actor=request.user)
            except services.ReviewError:
                continue  # already reviewed
