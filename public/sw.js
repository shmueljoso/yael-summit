/* Yael Summit service worker.
   Network first for the site's own files, so every visit gets the latest version;
   the last copy is kept only to open the app when there's no connection.
   API calls (/api/*) are never cached or touched. */
const CACHE = "yael-shell-v3";
const SHELL = ["/", "/app.js", "/i18n.js", "/styles.css", "/assets/summit-mark.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});

/* Phone notifications. The push carries no content: we ask the site what's new (with the
   member's own sign-in) and show it. Tapping it opens the right page. */
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let n = null;
    try {
      const r = await fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" });
      if (r.ok) n = (await r.json()).notifications[0] || null;
    } catch { /* offline: show a general notice */ }
    const title = n ? n.title : "Yael Summit";
    await self.registration.showNotification(title, {
      body: n ? n.body : "There's something new in your constellation.",
      icon: "/assets/icons/icon-192.png",
      badge: "/assets/icons/icon-192.png",
      tag: n ? `n${n.id}` : "yael",
      data: { url: "/" + (n && n.url ? n.url : "#/") },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url).catch(() => {}); }
    }
    return self.clients.openWindow(url);
  })());
});
