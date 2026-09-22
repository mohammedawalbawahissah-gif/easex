from django.urls import path

from .views import RateHistoryView, RatesView, TradeView

urlpatterns = [
    path("rates/", RatesView.as_view(), name="exchange-rates"),
    path("rate-history/", RateHistoryView.as_view(), name="exchange-rate-history"),
    path("trade/", TradeView.as_view(), name="exchange-trade"),
]
