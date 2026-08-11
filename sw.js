// Self-destructing service worker for retiring the former app.
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:'window'});
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
