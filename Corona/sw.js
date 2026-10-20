// "Service worker": un ayudante que el navegador guarda junto a la app.
// Su trabajo aquí es uno solo: tener copia de los archivos de la app dentro
// del celular, para que abra aunque no haya internet.

// IMPORTANTE: cada vez que cambies index.html, sube este número (v2, v3...).
// Así el iPhone se entera de que hay versión nueva y la descarga.
const VERSION = 'caja-v5';

const ARCHIVOS = ['./', './index.html', './manifest.json', './icono-180.png', './icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

// Borra las copias de versiones viejas
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(claves =>
    Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Primero busca en la copia guardada; si no está, va a internet
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
