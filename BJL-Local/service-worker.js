// Cache de la app para que funcione sin internet (primero cache, luego red)
const CACHE = "bjl-local-v2";
const ARCHIVOS = [
  "./", "index.html", "style.css", "app.js", "db.js", "receipts.js", "logo.js",
  "lib/jspdf.umd.min.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
