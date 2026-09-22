from django.apps import AppConfig


class TransactionsConfig(AppConfig):
    name = "apps.transactions"

    def ready(self):
        import apps.transactions.signals  # noqa: F401
