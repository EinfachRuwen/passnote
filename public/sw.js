// Netz zuerst, Cache nur als Notfall – so kommt jedes Update sofort an
const CACHE_NAME = 'passnote-v4';
const SHELL = [
    '/',
    '/board.html',
    '/manifest.json',
    '/assets/zettel.css?v=2',
    '/assets/board.js?v=2',
    '/assets/start.js?v=1'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL))
            .catch(() => {})
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

    e.respondWith(
        fetch(e.request)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                }
                return res;
            })
            .catch(() => caches.match(e.request, { ignoreSearch: url.pathname === '/board.html' }))
    );
});
