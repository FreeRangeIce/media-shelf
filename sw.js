/* FreeRangeMedia service worker — cache version V2.14 */
const CACHE = "media-shelf-v2.14";
/*
 * Cross-origin responses (cover images, APIs, CDNs) are never written to the cache: only
 * same-origin responses are (see the fetch handler). Comic data and covers from the Grand
 * Comics Database (comics.org, files1.comics.org) are not even routed through this worker,
 * so the browser loads them directly and nothing from those hosts can land in a cache
 * (Berean's condition for GCD covers).
 */
const NEVER_HANDLE_HOSTS = /(^|\.)comics\.org$/i;
/*
 * The comic Lookup relay (Cloudflare Worker frm-gcd) and the Tabletop relay (frm-tabletop) are
 * never routed through this worker either: their answers go straight to the page and are never
 * cached here.
 */
const RELAY_HOSTS = /^(frm-gcd|frm-gcd-review|frm-tabletop)\.freerangeice\.workers\.dev$/i;
/*
 * Comic cover pictures from Metron (static.metron.cloud) and Open Library
 * (covers.openlibrary.org) are never routed through this worker either, so the browser
 * loads them straight from those hosts and no image bytes can land in a cache.
 */
const IMAGE_HOSTS = /^(static\.metron\.cloud|covers\.openlibrary\.org)$/i;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./tabletop.js",
  "./manifest.webmanifest",
  "./data/seed.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/powered-by-google.png",
  "./icons/powered-by-bgg.svg",
  "./assets/platforms/xbox.svg",
  "./assets/platforms/playstation.svg",
  "./assets/platforms/switch.svg",
  "./assets/platforms/wii.svg",
  "./assets/platforms/wiiu.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" fetches every asset from the network, never from the browser's HTTP
    // cache, so a new version can't be installed with an older app.js or styles.css.
    // addAll rejects if any fetch fails, which fails the install and keeps the old worker.
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const host = new URL(req.url).hostname;
  if (NEVER_HANDLE_HOSTS.test(host) || RELAY_HOSTS.test(host) || IMAGE_HOSTS.test(host)) return; // straight to the network
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
