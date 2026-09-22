from django.contrib import admin

from .models import ExchangeRate


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    """This is the manual rate-setting screen — the placeholder for
    Breet's live pricing until that integration exists."""
    list_display = ["currency", "buy_rate", "sell_rate", "updated_at"]
