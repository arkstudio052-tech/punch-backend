const CACHE_NAME = 'punch-loyalty-cache-v19';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/config.js',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/punch_cover_photo.png',
  '/images/punch_cover_banner.png',
  '/images/punch_promo_banner.png',
  '/manifest.json'
];

// Install service worker and cache static app assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use helper to handle cache errors gracefully
      return cache.addAll(ASSETS).catch(err => {
        console.warn("Pre-caching assets warning:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate service worker and clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch handler: Network-first fallback to Cache (skip API requests)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    return;
  }
  
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(e.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
