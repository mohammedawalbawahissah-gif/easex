from django.core.management.base import BaseCommand

from apps.giftcards.catalog_data import sync_catalog
from apps.giftcards.models import GiftCardBrand, GiftCardSubcategory


class Command(BaseCommand):
    help = (
        "Create any brand/subcategory from catalog_data.py that doesn't exist yet. "
        "Never overwrites a rate, an active switch or an edited name, so it is safe to re-run."
    )

    def handle(self, *args, **options):
        result = sync_catalog(GiftCardBrand, GiftCardSubcategory)
        self.stdout.write(self.style.SUCCESS(
            f"Created {result['brands']} brand(s) and {result['subcategories']} subcategory(ies)."
        ))
