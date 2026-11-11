/* OptionFlow service worker: shows push notifications (buy-backs, trades) and opens the app on tap.
   No caching: the app stays online-only. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  const title = d.title || "OptionFlow";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    tag: d.tag || undefined,            // same tag replaces, no duplicate stack
    renotify: !!d.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/dashboard" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin)) { await w.focus(); try { await w.navigate(url); } catch { /* cross-origin */ } return; }
    }
    await self.clients.openWindow(url);
  })());
});
