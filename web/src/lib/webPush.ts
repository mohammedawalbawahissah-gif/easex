import { easex } from "./easexClient";

let warnedOnce = false;
function warnOnce(message: string) {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[web push] ${message}`);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function subscriptionToPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/**
 * Registers the service worker, requests notification permission,
 * and subscribes to push — uploading the subscription to the
 * backend. Deliberately forgiving: unsupported browser, denied
 * permission, or a missing VAPID key all just log one warning and
 * return, so the rest of the app works fine either way. Safe to
 * call repeatedly (login, page load) — the backend endpoint is an
 * upsert, same as the mobile push token flow.
 */
export async function syncWebPushWithBackend() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    warnOnce("Push isn't supported in this browser.");
    return;
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) {
    warnOnce("No VAPID public key configured (VITE_VAPID_PUBLIC_KEY) — push is disabled.");
    return;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    warnOnce("Notification permission was denied — in-app notifications still work.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const payload = subscriptionToPayload(subscription);
    if (!payload) return;
    await easex.notifications.registerWebPush(payload);
  } catch (err) {
    warnOnce(`Couldn't set up push: ${(err as Error).message}`);
  }
}

/** Unsubscribes and tells the backend to stop sending — call on
 * logout so a shared/reused browser profile doesn't keep getting
 * another account's pushes. */
export async function clearWebPushOnLogout() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const payload = subscriptionToPayload(subscription);
    if (payload) await easex.notifications.unregisterWebPush(payload.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Nothing to clean up, or already unreachable — fine either way.
  }
}

/**
 * Call once near the app root. When the service worker reports a
 * notification tap, navigate there the same way clicking it in-app
 * would — using a full navigation rather than the router so this
 * stays framework-agnostic inside the service worker itself.
 */
export function listenForNotificationTaps() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "NOTIFICATION_CLICK" && event.data.url) {
      window.location.href = event.data.url;
    }
  });
}
