from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    NotificationViewSet,
    register_push_token,
    register_web_push,
    unregister_push_token,
    unregister_web_push,
)

router = DefaultRouter()
router.register("", NotificationViewSet, basename="notification")

urlpatterns = [
    path("push-tokens/register/", register_push_token, name="push-token-register"),
    path("push-tokens/unregister/", unregister_push_token, name="push-token-unregister"),
    path("web-push/register/", register_web_push, name="web-push-register"),
    path("web-push/unregister/", unregister_web_push, name="web-push-unregister"),
] + router.urls
