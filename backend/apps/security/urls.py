from django.urls import path

from . import views

urlpatterns = [
    path("status/", views.SecurityStatusView.as_view(), name="security-status"),
    path("pin/", views.PinView.as_view(), name="security-pin"),
    path("2fa/setup/", views.TotpSetupView.as_view(), name="security-2fa-setup"),
    path("2fa/enable/", views.TotpEnableView.as_view(), name="security-2fa-enable"),
    path("2fa/disable/", views.TotpDisableView.as_view(), name="security-2fa-disable"),
    path("2fa/recovery-codes/", views.RecoveryCodesView.as_view(), name="security-recovery-codes"),
]
