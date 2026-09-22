from django.apps import AppConfig


class SecurityConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.security"

    def ready(self):
        # Django's own /admin/ must not be a password-only back door around staff 2FA.
        from django.contrib import admin

        from .admin_login import OtpAdminAuthenticationForm

        admin.site.login_form = OtpAdminAuthenticationForm
        admin.site.login_template = "admin/login_otp.html"
