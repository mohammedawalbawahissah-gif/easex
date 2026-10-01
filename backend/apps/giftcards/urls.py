from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import GiftCardCatalogView, GiftCardGalleryImageView, GiftCardImageView, GiftCardSubmissionViewSet

router = DefaultRouter()
router.register("", GiftCardSubmissionViewSet, basename="giftcard")

# Must come before the router's catch-all "<pk>/" route.
urlpatterns = [
    path("catalog/", GiftCardCatalogView.as_view(), name="giftcard-catalog"),
    path("<uuid:submission_id>/card-image/", GiftCardImageView.as_view(), name="giftcard-image"),
    path("gallery/<uuid:image_id>/", GiftCardGalleryImageView.as_view(), name="giftcard-gallery-image"),
] + router.urls
