from django.urls import path

from .views import (
    AdminCopilotView,
    AdminGiftCardAssessmentView,
    AdminKYCAssessmentView,
    AdminRiskSettingsView,
)

urlpatterns = [
    path("kyc/<uuid:submission_id>/assessment/", AdminKYCAssessmentView.as_view(), name="admin-kyc-assessment"),
    path(
        "giftcards/<uuid:submission_id>/assessment/",
        AdminGiftCardAssessmentView.as_view(),
        name="admin-giftcard-assessment",
    ),
    path("risk-settings/", AdminRiskSettingsView.as_view(), name="admin-risk-settings"),
    path("copilot/", AdminCopilotView.as_view(), name="admin-copilot"),
]
