from rest_framework.routers import DefaultRouter

from .views import KYCSubmissionViewSet

router = DefaultRouter()
router.register("kyc", KYCSubmissionViewSet, basename="kyc")

urlpatterns = router.urls
