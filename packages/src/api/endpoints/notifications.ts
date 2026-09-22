import type { ApiClient } from "../client";
import type { Notification } from "../../types";

export function notificationEndpoints(client: ApiClient) {
  return {
    list: () => client.get<Notification[]>("/api/notifications/"),
    get: (id: string) => client.get<Notification>(`/api/notifications/${id}/`),
    markRead: (id: string) =>
      client.patch<Notification>(`/api/notifications/${id}/`, { is_read: true }),
    registerPushToken: (expo_push_token: string, platform: "ios" | "android" | "web") =>
      client.post<{ expo_push_token: string; platform: string }>(
        "/api/notifications/push-tokens/register/",
        { expo_push_token, platform }
      ),
    unregisterPushToken: (expo_push_token: string) =>
      client.post<void>("/api/notifications/push-tokens/unregister/", { expo_push_token }),
    registerWebPush: (subscription: { endpoint: string; p256dh: string; auth: string }) =>
      client.post<{ endpoint: string; p256dh: string; auth: string }>(
        "/api/notifications/web-push/register/",
        subscription
      ),
    unregisterWebPush: (endpoint: string) =>
      client.post<void>("/api/notifications/web-push/unregister/", { endpoint }),
  };
}
