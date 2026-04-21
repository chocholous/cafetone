// Minimal service worker: cache the shell + let network handle API calls.
// PWA needs to be online to stamp anyway — offline mode is a v2 concern.
const CACHE = "cafetone-barista-v1";
const ASSETS = [
  "/pwa/",
  "/pwa/index.html",
  "/pwa/app.js",
  "/pwa/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Cache-first for shell assets only; everything else is network.
  if (url.pathname.startsWith("/pwa/") && ASSETS.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request)),
    );
    return;
  }
  // Default: network.
});
