import json
import logging
import urllib.request
import urllib.error

from celery import shared_task
from django.conf import settings
from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Expo's own limit per push API request.
BATCH_SIZE = 100


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def send_push_notification(self, notification_id):
    """
    Mobile (Expo) push — fire-and-forget from the post_save signal on
    Notification (see signals.py). Uses only the standard library for
    the HTTP call — this is a single simple JSON POST, not worth a
    new dependency.
    """
    from .models import Notification, PushDeviceToken

    try:
        notification = Notification.objects.select_related("user").get(pk=notification_id)
    except Notification.DoesNotExist:
        return  # nothing to send — deleted before the task ran

    tokens = list(
        PushDeviceToken.objects.filter(user=notification.user, is_active=True).values_list(
            "expo_push_token", flat=True
        )
    )
    if not tokens:
        return  # user has no registered devices — nothing to do

    for i in range(0, len(tokens), BATCH_SIZE):
        batch = tokens[i : i + BATCH_SIZE]
        messages = [
            {
                "to": token,
                "title": notification.title,
                "body": notification.body,
                "data": {
                    "notification_id": str(notification.id),
                    "category": notification.category,
                },
                "sound": "default",
            }
            for token in batch
        ]
        try:
            _post_to_expo(messages)
        except (urllib.error.URLError, TimeoutError) as exc:
            logger.warning("Expo push send failed for notification %s: %s", notification_id, exc)
            raise self.retry(exc=exc)


def _post_to_expo(messages):
    body = json.dumps(messages).encode("utf-8")
    req = urllib.request.Request(
        EXPO_PUSH_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    # Expo returns one ticket per message, in the same order. A
    # DeviceNotRegistered error means the token is dead (app
    # uninstalled, etc.) — deactivate it so we stop trying.
    from .models import PushDeviceToken

    tickets = payload.get("data", [])
    for message, ticket in zip(messages, tickets):
        if ticket.get("status") == "error" and ticket.get("details", {}).get("error") == "DeviceNotRegistered":
            PushDeviceToken.objects.filter(expo_push_token=message["to"]).update(is_active=False)


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def send_web_push(self, notification_id):
    """
    Browser push, via each subscribed tab's service worker (see
    web/public/sw.js). Same trigger as send_push_notification —
    both fire from the same signal, independently, so a user with
    both the app and a browser tab registered gets both.
    """
    if not settings.VAPID_PRIVATE_KEY:
        return  # no VAPID keypair configured — nothing to send with

    from .models import Notification, WebPushSubscription

    try:
        notification = Notification.objects.select_related("user").get(pk=notification_id)
    except Notification.DoesNotExist:
        return

    subscriptions = WebPushSubscription.objects.filter(user=notification.user, is_active=True)
    if not subscriptions:
        return

    payload = json.dumps({
        "title": notification.title,
        "body": notification.body,
        "data": {
            "notification_id": str(notification.id),
            "category": notification.category,
        },
    })

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL},
            )
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                # Browser unsubscribed or the subscription expired —
                # matches Expo's DeviceNotRegistered handling above.
                WebPushSubscription.objects.filter(pk=sub.pk).update(is_active=False)
            else:
                logger.warning("Web push send failed for notification %s: %s", notification_id, exc)
                raise self.retry(exc=exc)
