// Cache de la app para que funcione sin internet.
// Estrategia: responde al instante desde el cache y, en segundo plano, descarga la version nueva
// (asi las actualizaciones llegan solas la siguiente vez que se abre la app).
const CACHE = "bjl-app-v4";
const ARCHIVOS = [
  "./", "index.html", "style.css", "app.js", "store.js", "firebase-config.js", "receipts.js", "logo.js",
  "lib/jspdf.umd.min.js", "lib/firebase-bundle.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;   // Firebase y demas servicios van directo a la red
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then(r => { if (r && r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (guardado) { e.waitUntil(red); return guardado; }
    return (await red) || Response.error();
  })());
});
