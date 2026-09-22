from decimal import Decimal

from django.db import migrations


# Placeholder rates only — these are NOT live market prices. Update
# via Django admin as often as needed until Breet's real-time pricing
# is wired up. GHS-per-unit, illustrative as of when this was written.
SEED_RATES = [
    {"currency": "BTC", "buy_rate": Decimal("650000.00"), "sell_rate": Decimal("645000.00")},
    {"currency": "ETH", "buy_rate": Decimal("38000.00"), "sell_rate": Decimal("37500.00")},
    {"currency": "USDT", "buy_rate": Decimal("15.60"), "sell_rate": Decimal("15.40")},
]


def seed_rates(apps, schema_editor):
    ExchangeRate = apps.get_model("exchange", "ExchangeRate")
    for rate in SEED_RATES:
        ExchangeRate.objects.get_or_create(currency=rate["currency"], defaults=rate)


def remove_seeded_rates(apps, schema_editor):
    ExchangeRate = apps.get_model("exchange", "ExchangeRate")
    ExchangeRate.objects.filter(currency__in=[r["currency"] for r in SEED_RATES]).delete()


class Migration(migrations.Migration):
    dependencies = [("exchange", "0001_initial")]
    operations = [migrations.RunPython(seed_rates, remove_seeded_rates)]
