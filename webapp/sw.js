// Hors ligne. À l'installation, tout ce qu'il faut pour écouter (page, scripts, modèle, polices,
// mascotte) est mis en cache d'un coup, puis les photos du guide en arrière-plan : l'app marche
// sans réseau dès la première ouverture terminée, même installée sur l'écran d'accueil.
// Les gros fichiers viennent toujours du cache ; la page et les scripts sont redemandés au réseau
// pour suivre les mises à jour, mais sans attendre plus de 3 s (réseau faible en balade).
const CACHE = "birdlistener-v16";
const GROS = /\/(modele|vendor|photos|mascotte)\/|\/api\/son/;
const ESSENTIEL = [
  "./", "style.css", "app.js", "carte.js", "reconnaissance.js", "ouverture.js", "capteur.js",
  "manifest.webmanifest", "icone-180.png", "icone-192.png", "mascotte/sprites.png",
  "polices/big-shoulders.woff2", "polices/instrument-sans.woff2", "polices/instrument-serif-italique.woff2", "polices/silkscreen.woff2",
  "modele/meta.json", "modele/frequences.json", "modele/classifieur.bin", "modele/birdnet.tflite",
  "vendor/litert.mjs", "vendor/wasm-utils.mjs",
  "vendor/litert/litert_wasm_internal.js", "vendor/litert/litert_wasm_internal.wasm",
  "vendor/litert/litert_wasm_compat_internal.js", "vendor/litert/litert_wasm_compat_internal.wasm",
  "photos/credits.json",
];

async function photos(cache) {
  const r = await cache.match("photos/credits.json");
  if (!r) return;
  const fichiers = Object.values(await r.json()).map((c) => "photos/" + encodeURI(c.fichier));
  for (let i = 0; i < fichiers.length; i += 20)      // par petits lots, sans bloquer l'app
    await Promise.allSettled(fichiers.slice(i, i + 20).map(async (f) => (await cache.match(f)) || cache.add(f)));
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ESSENTIEL.map((u) => new Request(u, { cache: "no-cache" })))));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim())
    .then(() => caches.open(CACHE)).then(photos).catch(() => {})));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const enCache = await cache.match(e.request);
    if (enCache && GROS.test(new URL(e.request.url).pathname)) return enCache;
    const reseau = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; });
    if (!enCache) return reseau;
    reseau.catch(() => {});
    const patience = new Promise((ok) => setTimeout(() => ok(enCache), 3000));
    return Promise.race([reseau, patience]).catch(() => enCache);
  }));
});
