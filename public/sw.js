/*
 * Township's service worker. It exists for ONE thing: when the phone has no network, show a page that says so instead of the browser's error.
 *
 * What it keeps: the offline page and the icons, listed in PUBLIC below, fetched without credentials at install. Nothing else is ever stored.
 * What it never touches: a page after login, an /api response, a Server Action, a POST, or anything that carried a cookie. Those requests are left to the
 * browser, so no one's dues, complaints or session can end up in a cache that outlives their logout. There is deliberately no cache.put in this file.
 * Bump VERSION when this file or the list changes: the activate step then deletes every cache of an older version.
 */
const VERSION = "v1";
const CACHE = `township-public-${VERSION}`;
const OFFLINE_PAGE = "/offline.html";
const PUBLIC = [OFFLINE_PAGE, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PUBLIC.map((path) => new Request(path, { credentials: "omit" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first. Only when the network fails is the offline page shown; a page that loads is never stored.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE, { cacheName: CACHE })));
    return;
  }
  if (PUBLIC.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
  }
});
