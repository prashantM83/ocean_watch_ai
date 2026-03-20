// ============================================================
// OceanWatch AI — Service Worker
// Offline support with network-first strategy for APIs
// ============================================================

const CACHE_NAME = 'oceanwatch-v2';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './data.js',
    './api.js',
    './engine.js',
    './chat.js',
    './app.js'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Network-first for APIs, cache-first for static
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Network-first for API calls
    if (url.hostname.includes('open-meteo.com') || url.hostname.includes('googleapis.com')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Cache-first for CDN resources (Leaflet, Chart.js, fonts)
    if (url.hostname !== location.hostname) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
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

    // Cache-first for local static assets
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
