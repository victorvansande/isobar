/* Isobar service worker: the app opens instantly and still works offline.
   App files are network-first, so every deploy shows up right away, but a slow or dead connection gives up after
   a few seconds and opens the last copy instead of hanging on a blank screen. Fonts and the map library never change,
   so they come straight from the cache. Weather, radar and map data always go to the network
   (the app keeps its own copy of the last forecasts). */
const CACHE = "isobar-v6";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./palette.js", "./assets/moon-map.js", "./manifest.webmanifest", "./assets/icon-192.png", "./assets/apple-touch-icon.png"];
const LIBS = [
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Urbanist:wght@200;300;400&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];
const LIVE = /open-meteo\.com|rainviewer\.com|arcgisonline\.com|bigdatacloud\.net|githubusercontent\.com/;
const FIXED = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    // third-party files answer opaquely, which addAll refuses, so store them one by one (best effort)
    await Promise.all(LIBS.map(u => fetch(u, { mode: "no-cors" }).then(r => c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const keep = (req, res) => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
const fromCache = req => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || LIVE.test(req.url)) return;
  if (FIXED.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => keep(req, res))));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fallback = () => fromCache(req).then(hit => { if (!done && hit) { done = true; resolve(hit); } return hit; });
    // after 3.5 s without an answer, open the last copy (the network copy still lands in the cache for next time)
    const timer = setTimeout(fallback, 3500);
    fetch(req).then(res => { clearTimeout(timer); keep(req, res); if (!done) { done = true; resolve(res); } })
      .catch(() => { clearTimeout(timer); fallback().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  }));
});
