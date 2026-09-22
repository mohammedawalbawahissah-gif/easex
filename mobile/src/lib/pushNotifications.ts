import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { easex } from "./easexClient";

// Foreground behavior: still show an alert/sound even while the app
// is open, so a settlement or KYC decision doesn't go unnoticed just
// because the user happened to have the app in front of them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let warnedOnce = false;

/**
 * Requests permission and returns an Expo push token, or null if
 * push isn't usable right now. This is deliberately forgiving:
 *  - Simulators/emulators have no push capability at all.
 *  - Expo Go on Android has not supported remote push since SDK 53 —
 *    this needs a development build (`eas build --profile development`).
 *  - Without an EAS project (`extra.eas.projectId` in app.json, set
 *    automatically by `eas init`), Expo has no project to route the
 *    token through.
 * In every one of those cases this logs one clear warning and
 * returns null rather than throwing — the rest of the app keeps
 * working with in-app notifications regardless of push status.
 */
export async function registerForPushNotificationsAsync(): Promise<{
  token: string;
  platform: "ios" | "android";
} | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;

  if (!Device.isDevice) {
    logOnce("Push notifications need a physical device — skipping on simulator/emulator.");
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    logOnce(
      "Push notifications need an EAS project — run `eas init` (this fills in extra.eas.projectId in app.json automatically), then rebuild."
    );
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: "#c98a2c",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    logOnce("Push notification permission was denied — in-app notifications still work.");
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token, platform: Platform.OS };
  } catch (err) {
    // Most commonly hit here: Expo Go on Android (SDK 53+ dropped
    // remote push support entirely) — Expo throws rather than
    // returning a token. A dev/standalone build resolves this.
    logOnce(`Couldn't get a push token (${(err as Error).message}). A development build may be required.`);
    return null;
  }
}

function logOnce(message: string) {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[push] ${message}`);
}

/** Registers this device's token with the backend for the currently
 * logged-in user. Safe to call repeatedly (login, app foreground) —
 * the backend endpoint is an upsert. */
export async function syncPushTokenWithBackend() {
  const result = await registerForPushNotificationsAsync();
  if (!result) return;
  try {
    await easex.notifications.registerPushToken(result.token, result.platform);
  } catch {
    // Non-fatal — a failed sync just means push is unavailable until
    // the next successful registration attempt.
  }
}

/** Deactivates this device's token on the backend — call on logout
 * so a shared/reused device stops receiving another account's pushes. */
export async function clearPushTokenOnLogout() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || !Device.isDevice) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await easex.notifications.unregisterPushToken(token);
  } catch {
    // Nothing to unregister, or already unreachable — fine either way.
  }
}

/**
 * Mount once near the app root. Handles the case where the user
 * taps a push notification (app was backgrounded or closed) by
 * navigating to that notification's detail screen — the same place
 * tapping it in-app goes.
 */
export function useNotificationTapNavigation() {
  const router = useRouter();
  const subscriptionRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    subscriptionRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const notificationId = response.notification.request.content.data?.notification_id as string | undefined;
      if (notificationId) {
        router.replace(`/notification/${notificationId}`);
      }
    });
    return () => {
      subscriptionRef.current?.remove();
    };
  }, [router]);
}
