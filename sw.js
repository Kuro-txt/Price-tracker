// SunChart Service Worker — Background Web Push Handler

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Background Push Event Handler (Fires when browser is closed) ────────────
self.addEventListener("push", (event) => {
  let data = {
    title: "SunChart Market Alert",
    body: "Price movement detected on Sunflower Land resources.",
    icon: "https://sfl.world/favicon.ico"
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (_) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "https://sfl.world/favicon.ico",
    badge: "https://sfl.world/favicon.ico",
    vibrate: [200, 100, 200],
    data: {
      url: "/"
    },
    actions: [
      { action: "open", title: "View Market" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "SunChart Alert", options)
  );
});

// ─── Notification Click Handler ──────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
    })
  );
});
