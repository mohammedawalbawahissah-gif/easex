from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import GiftCardCatalogView, GiftCardSubmissionViewSet

router = DefaultRouter()
router.register("", GiftCardSubmissionViewSet, basename="giftcard")

# Must come before the router's catch-all "<pk>/" route.
urlpatterns = [path("catalog/", GiftCardCatalogView.as_view(), name="giftcard-catalog")] + router.urls
