from decimal import Decimal

from django.db import migrations


FLAT_RATE = Decimal("0.8500")

# Remember what 0005 set, so reversing this migration can restore the
# differentiated rates rather than just leaving everything at 0.85.
PREVIOUS_RATES = {
    "amazon": Decimal("0.8700"),
    "apple": Decimal("0.8300"),
    "google_play": Decimal("0.8500"),
    "steam": Decimal("0.8000"),
    "playstation": Decimal("0.8400"),
    "xbox": Decimal("0.8400"),
    "razer_gold": Decimal("0.8200"),
    "walmart": Decimal("0.8800"),
    "target": Decimal("0.8600"),
    "ebay": Decimal("0.7900"),
    "nike": Decimal("0.8500"),
    "other": Decimal("0.7000"),
}


def flatten_rates(apps, schema_editor):
    """
    The product went back to a single flat payout rate for every
    brand (see web/mobile GiftCards revert) — this keeps the backend
    honest with what the UI now actually claims, instead of quietly
    paying out a different amount per brand behind a flat-sounding
    "85% of face value" message. The per-brand GiftCardRate model
    itself stays — it's ready to hold real differentiated rates again
    once trustworthy market data is available.
    """
    GiftCardRate = apps.get_model("giftcards", "GiftCardRate")
    GiftCardRate.objects.update(rate=FLAT_RATE)


def restore_previous_rates(apps, schema_editor):
    GiftCardRate = apps.get_model("giftcards", "GiftCardRate")
    for brand, rate in PREVIOUS_RATES.items():
        GiftCardRate.objects.filter(brand=brand).update(rate=rate)


class Migration(migrations.Migration):
    dependencies = [("giftcards", "0005_seed_giftcard_rates")]
    operations = [migrations.RunPython(flatten_rates, restore_previous_rates)]
