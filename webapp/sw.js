// Hors ligne : les gros fichiers (modèle, bibliothèques, photos) viennent du cache ;
// la page et les scripts sont redemandés au réseau quand il est là, pour suivre les mises à jour.
const CACHE = "birdlistener-v7";
const GROS = /\/(modele|vendor|photos|ouverture)\/|\/api\/son/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const enCache = await cache.match(e.request);
    if (enCache && GROS.test(new URL(e.request.url).pathname)) return enCache;
    try {
      const r = await fetch(e.request);
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      if (enCache) return enCache;
      throw err;
    }
  }));
});
