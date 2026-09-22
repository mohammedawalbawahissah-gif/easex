import datetime

import django.utils.timezone
from django.db import migrations, models

HELP = (
    "Login sessions issued before this moment are refused. Bumped on password change/reset "
    "and 2FA changes, so a stolen token stops working."
)


class Migration(migrations.Migration):
    dependencies = [("users", "0001_initial")]

    operations = [
        # Existing users are backfilled with an OLD date so that deploying this doesn't invalidate
        # everyone's current session. Only a real security event moves it forward.
        migrations.AddField(
            model_name="user",
            name="security_epoch",
            field=models.DateTimeField(default=datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc), help_text=HELP),
            preserve_default=False,
        ),
        # New accounts start at "now" (the model default).
        migrations.AlterField(
            model_name="user",
            name="security_epoch",
            field=models.DateTimeField(default=django.utils.timezone.now, help_text=HELP),
        ),
    ]
