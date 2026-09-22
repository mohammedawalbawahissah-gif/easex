// EaseX web push service worker.
// Vite serves everything in public/ from the site root, so this
// file is reachable at /sw.js in both dev and production — required,
// since a service worker's scope is limited to its own directory
// and everything below it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // not JSON — not one of ours, ignore rather than crash
  }

  const { title, body, data } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "EaseX", {
      body: body || "",
      data,
      tag: data?.notification_id, // replaces any existing notification for the same item instead of stacking
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationId = event.notification.data?.notification_id;
  const targetUrl = notificationId ? `/notifications/${notificationId}` : "/wallet";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open tab if there is one, rather than
      // stacking browser windows every time a notification is tapped.
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICK", url: targetUrl });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
