from rest_framework.routers import DefaultRouter

from .views import SupportSessionViewSet

router = DefaultRouter()
router.register("", SupportSessionViewSet, basename="support")

urlpatterns = router.urls
