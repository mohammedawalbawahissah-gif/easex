from django.apps import AppConfig


class ExchangeConfig(AppConfig):
    name = "apps.exchange"

    def ready(self):
        from . import signals  # noqa: F401 — registers the post_save receiver
