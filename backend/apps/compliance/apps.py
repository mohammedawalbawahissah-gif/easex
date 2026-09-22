from django.apps import AppConfig


class ComplianceConfig(AppConfig):
    name = 'apps.compliance'

    def ready(self):
        import apps.compliance.signals  # noqa: F401
