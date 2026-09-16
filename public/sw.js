const CACHE_NAME = 'passnote-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/board.html',
    '/admin.html',
    '/manifest.json',
    '/assets/style.css',
    '/assets/app.js',
    '/assets/admin.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) {
        return; // Network only for APIs and WebSocket
    }
    
    e.respondWith(
        caches.match(e.request).then((cached) => {
            return cached || fetch(e.request);
        })
    );
});
