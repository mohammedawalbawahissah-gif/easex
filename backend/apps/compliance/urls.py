from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import KYCImageView, KYCSubmissionViewSet

router = DefaultRouter()
router.register("kyc", KYCSubmissionViewSet, basename="kyc")

urlpatterns = [
    path("kyc/<uuid:submission_id>/image/<str:field>/", KYCImageView.as_view(), name="kyc-image"),
] + router.urls
