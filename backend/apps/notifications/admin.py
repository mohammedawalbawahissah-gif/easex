from django.contrib import admin
from .models import Notification, PushDeviceToken, WebPushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["user", "category", "title", "is_read", "created_at"]
    list_filter = ["category", "is_read"]


@admin.register(PushDeviceToken)
class PushDeviceTokenAdmin(admin.ModelAdmin):
    list_display = ["user", "platform", "is_active", "created_at", "last_used_at"]
    list_filter = ["platform", "is_active"]
    search_fields = ["user__username", "expo_push_token"]


@admin.register(WebPushSubscription)
class WebPushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "is_active", "created_at", "last_used_at"]
    list_filter = ["is_active"]
    search_fields = ["user__username", "endpoint"]
