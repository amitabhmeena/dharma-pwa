// DHARMA Dam Safety Map – Service Worker
// Caches the app shell + all local data files for offline use.
// ArcGIS tile/map requests are served from network when online
// and from cache when offline (stale-while-revalidate for tiles).

const CACHE_NAME = "dharma-v1";
const TILE_CACHE  = "dharma-tiles-v1";

// App shell: files that must be cached on install
const SHELL_URLS = [
  "./index.html",
  "./manifest.json",
  "./dams.json",
  "./river-basins.geojson",
  "./ho-sites.geojson",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

// ── Install: cache app shell ──────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        SHELL_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn("[SW] Failed to cache:", url, err)
          )
        )
      );
    })
  );
});

// ── Activate: clear old caches ────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // 1. Local data files → cache-first (they're large; update on next install)
  if (
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".geojson") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".css")
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 2. ArcGIS map tiles → stale-while-revalidate (show cached, refresh in bg)
  if (
    url.hostname.includes("arcgis.com") ||
    url.hostname.includes("arcgisonline.com") ||
    url.hostname.includes("esri.com")
  ) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request)
            .then(response => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached); // offline fallback to cached tile

          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // 3. Everything else → network with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Background sync: re-cache data files when back online ────────────────────
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "REFRESH_DATA") {
    caches.open(CACHE_NAME).then(cache => {
      ["./dams.json", "./river-basins.geojson", "./ho-sites.geojson"].forEach(url => {
        fetch(url).then(r => { if (r.ok) cache.put(url, r); });
      });
    });
  }
});
