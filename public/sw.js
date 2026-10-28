/* Yael Summit service worker.

   Opening the app should feel instant, like a native app, so the site's own files (the "shell":
   page, code, styles, translations) come from the copy kept on the phone, and the latest version is
   fetched in the background. The shell is updated as one set: if any file changed, all of them are
   replaced together, so new code never runs with old code. The page is told, and reloads itself
   the next time it's opened.

   Fonts, icons and profile photos (whose address changes with each new photo) are kept once fetched.
   Other API calls (/api/*) are never cached here. */
const SHELL_CACHE = "yael-shell-v4";
const FILES_CACHE = "yael-files-v1";
const LANGS = ["es", "fr", "ru", "he", "de", "pt", "uk"];
const SHELL = ["/", "/app.js", "/i18n.js", "/styles.css", "/fonts/fonts.css", "/manifest.webmanifest", ...LANGS.map((l) => `/i18n/${l}.js`)];
const KEEP = [SHELL_CACHE, FILES_CACHE];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const shellPath = (url) => (url.pathname === "/index.html" ? "/" : url.pathname);
const isShell = (url) => SHELL.includes(shellPath(url));
const isFile = (url) => /^\/(fonts|assets|vendor)\//.test(url.pathname) || (url.pathname.startsWith("/api/avatar/") && url.searchParams.has("v"));

/** Fetches the whole shell again; if anything changed, swaps it in as one set and tells open pages. */
let checking = null;
function refreshShell() {
  checking ??= (async () => {
    const fresh = await Promise.all(SHELL.map((u) => fetch(u, { cache: "no-cache" }).catch(() => null)));
    if (fresh.some((r) => !r || !r.ok)) return;            // offline or a hiccup: keep the current set
    const cache = await caches.open(SHELL_CACHE);
    let changed = false;
    for (let i = 0; i < SHELL.length && !changed; i++) {
      const old = await cache.match(SHELL[i]);
      if (!old) { changed = true; break; }
      const [a, b] = [old.headers.get("etag"), fresh[i].headers.get("etag")];
      changed = a && b ? a !== b : (await old.clone().text()) !== (await fresh[i].clone().text());
    }
    if (!changed) return;
    await Promise.all(SHELL.map((u, i) => cache.put(u, fresh[i])));
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "updated" });
  })().finally(() => { checking = null; });
  return checking;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate" || isShell(url)) {
    const key = req.mode === "navigate" ? "/" : shellPath(url);
    // Each time the app opens, look for a new version in the background.
    if (req.mode === "navigate") e.waitUntil(caches.match("/", { cacheName: SHELL_CACHE }).then((hit) => hit && refreshShell()));
    e.respondWith(caches.match(key, { cacheName: SHELL_CACHE }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(key, copy)); }
        return res;
      });
    }));
    return;
  }

  if (isFile(url)) {
    e.respondWith(caches.open(FILES_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone());
        cache.keys().then((keys) => { if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => cache.delete(k)); });
      }
      return res;
    }));
  }
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
