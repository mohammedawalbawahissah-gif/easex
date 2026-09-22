from django.db import migrations

from apps.giftcards.catalog_data import sync_catalog


def seed(apps, schema_editor):
    sync_catalog(apps.get_model("giftcards", "GiftCardBrand"), apps.get_model("giftcards", "GiftCardSubcategory"))


class Migration(migrations.Migration):
    dependencies = [("giftcards", "0005_gift_card_catalog")]

    # Data only. Reversing leaves the catalog in place: deleting brands would be
    # blocked by (and could not safely orphan) real submissions that reference them.
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
