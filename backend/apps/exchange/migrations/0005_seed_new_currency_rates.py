from decimal import Decimal

from django.db import migrations


# Placeholder rates only — same caveat as 0002_seed_rates.py: NOT
# live market prices. Update via the admin review portal as often
# as needed until real pricing is wired up.
NEW_SEED_RATES = [
    {"currency": "USDC", "buy_rate": Decimal("15.60"), "sell_rate": Decimal("15.40")},
    {"currency": "BNB", "buy_rate": Decimal("9200.00"), "sell_rate": Decimal("9100.00")},
    {"currency": "SOL", "buy_rate": Decimal("2850.00"), "sell_rate": Decimal("2800.00")},
    {"currency": "XRP", "buy_rate": Decimal("8.40"), "sell_rate": Decimal("8.20")},
    {"currency": "ADA", "buy_rate": Decimal("6.10"), "sell_rate": Decimal("5.95")},
    {"currency": "DOGE", "buy_rate": Decimal("3.20"), "sell_rate": Decimal("3.05")},
    {"currency": "LTC", "buy_rate": Decimal("1450.00"), "sell_rate": Decimal("1420.00")},
]


def seed_new_rates(apps, schema_editor):
    ExchangeRate = apps.get_model("exchange", "ExchangeRate")
    ExchangeRateHistory = apps.get_model("exchange", "ExchangeRateHistory")
    for rate in NEW_SEED_RATES:
        obj, created = ExchangeRate.objects.get_or_create(currency=rate["currency"], defaults=rate)
        if created:
            ExchangeRateHistory.objects.create(
                currency=obj.currency, buy_rate=obj.buy_rate, sell_rate=obj.sell_rate
            )


def remove_new_rates(apps, schema_editor):
    ExchangeRate = apps.get_model("exchange", "ExchangeRate")
    ExchangeRate.objects.filter(currency__in=[r["currency"] for r in NEW_SEED_RATES]).delete()


class Migration(migrations.Migration):
    dependencies = [("exchange", "0004_alter_exchangerate_currency_and_more")]
    operations = [migrations.RunPython(seed_new_rates, remove_new_rates)]
