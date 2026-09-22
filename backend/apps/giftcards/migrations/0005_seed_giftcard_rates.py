from decimal import Decimal

from django.db import migrations


# Placeholder rates only — not live market prices. Update via Django
# admin as often as needed. Brands that are easier to resell quickly
# (Amazon, Walmart) clear at a higher rate than niche ones; "other" is
# deliberately the lowest since it's unverified/highest-risk.
SEED_RATES = [
    {"brand": "amazon", "rate": Decimal("0.8700")},
    {"brand": "apple", "rate": Decimal("0.8300")},
    {"brand": "google_play", "rate": Decimal("0.8500")},
    {"brand": "steam", "rate": Decimal("0.8000")},
    {"brand": "playstation", "rate": Decimal("0.8400")},
    {"brand": "xbox", "rate": Decimal("0.8400")},
    {"brand": "razer_gold", "rate": Decimal("0.8200")},
    {"brand": "walmart", "rate": Decimal("0.8800")},
    {"brand": "target", "rate": Decimal("0.8600")},
    {"brand": "ebay", "rate": Decimal("0.7900")},
    {"brand": "nike", "rate": Decimal("0.8500")},
    {"brand": "other", "rate": Decimal("0.7000")},
]


def seed_rates(apps, schema_editor):
    GiftCardRate = apps.get_model("giftcards", "GiftCardRate")
    for rate in SEED_RATES:
        GiftCardRate.objects.get_or_create(brand=rate["brand"], defaults=rate)


def remove_seeded_rates(apps, schema_editor):
    GiftCardRate = apps.get_model("giftcards", "GiftCardRate")
    GiftCardRate.objects.filter(brand__in=[r["brand"] for r in SEED_RATES]).delete()


class Migration(migrations.Migration):
    dependencies = [("giftcards", "0004_giftcardrate_giftcardratehistory")]
    operations = [migrations.RunPython(seed_rates, remove_seeded_rates)]
