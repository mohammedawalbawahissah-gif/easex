import uuid
from django.conf import settings
from django.db import models


class Notification(models.Model):
    """
    In-app notifications (e.g. 'your gift card was verified',
    'payout sent'). Kept simple; push-notification delivery via
    Expo can hook into the post_save signal for this model later.
    """

    class Category(models.TextChoices):
        TRANSACTION_UPDATE = "transaction_update", "Transaction Update"
        KYC_UPDATE = "kyc_update", "KYC Update"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    category = models.CharField(max_length=30, choices=Category.choices)
    title = models.CharField(max_length=150)
    body = models.TextField(blank=True)
    # Generic reference to what this notification is ABOUT, letting a
    # frontend deep-link straight to the relevant screen instead of just
    # showing static text — e.g. related_type="support_session",
    # related_id=<session id> for an escalation notification, so tapping
    # it can go straight to that conversation. Both blank for the (still
    # most common) case of a notification with nothing to link to.
    related_type = models.CharField(max_length=30, blank=True)
    related_id = models.CharField(max_length=64, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} → {self.user}"


class PushDeviceToken(models.Model):
    """
    An Expo push token for one installation of the app on one
    device. A user can have several (phone + tablet, or a reinstall
    that generated a new token) — all active ones get a push when a
    Notification is created for that user (see signals.py).
    """

    class Platform(models.TextChoices):
        IOS = "ios", "iOS"
        ANDROID = "android", "Android"
        WEB = "web", "Web"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_tokens"
    )
    expo_push_token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=10, choices=Platform.choices)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["user", "is_active"])]

    def __str__(self):
        return f"{self.platform} token for {self.user} ({'active' if self.is_active else 'inactive'})"


class WebPushSubscription(models.Model):
    """
    A browser's Push API subscription — the web equivalent of
    PushDeviceToken. `endpoint`/`p256dh`/`auth` are exactly the three
    fields returned by the browser's PushSubscription.toJSON(); all
    three are required to encrypt and route a push via pywebpush.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="web_push_subscriptions"
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["user", "is_active"])]

    def __str__(self):
        return f"Web push subscription for {self.user} ({'active' if self.is_active else 'inactive'})"
