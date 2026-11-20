/* QR Studio: PWA offline cache. Mude a versão ao publicar novas alterações. */
const CACHE = 'qr-studio-static-v6';
const EXTERNAL_CACHE = 'qr-studio-dependencies-v1';
const LOCAL_FILES = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
const DEPENDENCIES = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Caveat:wght@600&family=Playfair+Display:wght@600&display=swap'
];

async function storeDependency(url) {
  const cache = await caches.open(EXTERNAL_CACHE);
  // Para scripts sem crossorigin, no-cors espelha a requisição do navegador.
  const request = new Request(url, {mode: 'no-cors', credentials: 'omit'});
  const response = await fetch(request);
  if (!response || !(response.ok || response.type === 'opaque')) throw Error('Não foi possível guardar ' + url);
  await cache.put(request, response);
}

async function preloadFonts() {
  const url = DEPENDENCIES[2];
  try {
    const response = await fetch(url, {mode:'cors'});
    if (!response.ok) return;
    const css = await response.text();
    const cache = await caches.open(EXTERNAL_CACHE);
    // Salva também a versão CORS da folha para uso offline em exportações.
    await cache.put(new Request(url, {mode:'cors'}), new Response(css, {headers:{'Content-Type':'text/css'}}));
    const fontUrls = [...css.matchAll(/url\((?:['"]?)(https:\/\/[^)'" ]+)/g)].map(match=>match[1]);
    await Promise.all([...new Set(fontUrls)].map(async fontUrl => {
      try {
        const r = await fetch(fontUrl, {mode:'cors'});
        if (r.ok) await cache.put(fontUrl, r);
      } catch(e) { console.warn('Fonte não armazenada:', fontUrl, e); }
    }));
  } catch(e) { console.warn('Não foi possível pré-carregar todas as fontes:', e); }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const local = await caches.open(CACHE);
    await local.addAll(LOCAL_FILES);
    // A biblioteca do QR e o CSS do Tailwind são necessários para offline.
    await Promise.all(DEPENDENCIES.slice(0,2).map(storeDependency));
    await Promise.allSettled([storeDependency(DEPENDENCIES[2]), preloadFonts()]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('qr-studio-') && k !== CACHE && k !== EXTERNAL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const u = new URL(request.url);
  const local = u.origin === self.location.origin;
  const knownExternal = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname);
  if (!local && !knownExternal) return;
  event.respondWith((async () => {
    const cache = await caches.open(local ? CACHE : EXTERNAL_CACHE);
    const cached = await cache.match(request, {ignoreVary: true});
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        // Store original request, preserving request mode for scripts/fonts.
        await cache.put(request, response.clone());
      }
      return response;
    } catch(error) {
      if (local && request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
