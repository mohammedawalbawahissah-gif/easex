from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import Notification, PushDeviceToken, WebPushSubscription
from .serializers import NotificationSerializer, PushDeviceTokenSerializer, WebPushSubscriptionSerializer


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "head"]  # patch used to mark as read

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def register_push_token(request):
    """
    Called after login (and on app foreground, harmlessly — it's an
    upsert) with the device's Expo push token. If the same token was
    previously registered to a different user (device changed hands,
    or someone logged in as a different account on the same phone),
    it's reassigned rather than duplicated — a token can only ever
    point at whoever is currently logged in on that device.
    """
    serializer = PushDeviceTokenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    token, _ = PushDeviceToken.objects.update_or_create(
        expo_push_token=serializer.validated_data["expo_push_token"],
        defaults={
            "user": request.user,
            "platform": serializer.validated_data["platform"],
            "is_active": True,
        },
    )
    return Response(PushDeviceTokenSerializer(token).data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def unregister_push_token(request):
    """Called on logout so a shared or reused device stops getting
    pushes for an account nobody's signed into anymore."""
    token = request.data.get("expo_push_token")
    if not token:
        raise serializers.ValidationError({"expo_push_token": "Required."})
    PushDeviceToken.objects.filter(expo_push_token=token, user=request.user).update(is_active=False)
    return Response(status=204)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def register_web_push(request):
    """Web equivalent of register_push_token above — same upsert
    reasoning, keyed on `endpoint` instead of a token string."""
    serializer = WebPushSubscriptionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    sub, _ = WebPushSubscription.objects.update_or_create(
        endpoint=serializer.validated_data["endpoint"],
        defaults={
            "user": request.user,
            "p256dh": serializer.validated_data["p256dh"],
            "auth": serializer.validated_data["auth"],
            "is_active": True,
        },
    )
    return Response(WebPushSubscriptionSerializer(sub).data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def unregister_web_push(request):
    endpoint = request.data.get("endpoint")
    if not endpoint:
        raise serializers.ValidationError({"endpoint": "Required."})
    WebPushSubscription.objects.filter(endpoint=endpoint, user=request.user).update(is_active=False)
    return Response(status=204)
