from rest_framework import serializers
from .models import Notification, PushDeviceToken, WebPushSubscription


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "category", "title", "body", "is_read", "created_at"]
        read_only_fields = ["id", "category", "title", "body", "created_at"]


class PushDeviceTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushDeviceToken
        fields = ["expo_push_token", "platform"]
        extra_kwargs = {
            # The view's update_or_create() IS the uniqueness handling
            # (re-registering the same token on every app foreground is
            # expected, not an error) — DRF's auto-generated
            # UniqueValidator would otherwise reject every call after
            # the first with a 400.
            "expo_push_token": {"validators": []},
        }


class WebPushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebPushSubscription
        fields = ["endpoint", "p256dh", "auth"]
        extra_kwargs = {
            # Same reasoning as PushDeviceTokenSerializer above — the
            # browser re-sends the same subscription on every page
            # load and the view's update_or_create() handles that.
            "endpoint": {"validators": []},
        }
