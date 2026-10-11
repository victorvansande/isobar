/* Isobar service worker: the app opens instantly and still works offline.
   App files, fonts and libraries are network-first, so every deploy shows up right away, with the last copy
   as a fallback when offline. Weather, radar and map data always go straight to the network
   (the app keeps its own copy of the last forecast). */
const CACHE = "isobar-v1";
const SHELL = ["./", "./index.html", "./palette.js", "./assets/moon-map.js", "./manifest.webmanifest", "./assets/icon-192.png", "./assets/apple-touch-icon.png"];
const LIVE = /open-meteo\.com|rainviewer\.com|arcgisonline\.com|bigdatacloud\.net/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || LIVE.test(req.url)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
