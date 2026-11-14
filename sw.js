// Makes repeat visits near-instant. This file stays simple because of how the site
// is released (see tools/release.mjs): everything under app/ has its content in its
// name, so a cached copy can never be out of date, and index.html is the only file
// that changes. Change CACHE to clear every visitor's cache.
const CACHE = 'marswalk-1';
const MAX_ENTRIES = 80;
// Leaflet now ships in app/. Only a page saved before that move still asks for this
// address, and it must keep working, so its saved copy stays in use.
const OLD_LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';

// How long a repeat visit waits for a fresh page. On a good connection the visitor
// gets any new deploy at once. On a slow one the saved page opens instead, and the
// fresh one is ready for next time. Either way, the page names a complete set of files.
const FRESH_PAGE_WAIT_MS = 200;

const scope = () => self.registration.scope;
const isVersioned = (url) => url.startsWith(`${scope()}app/`) || url.startsWith(OLD_LEAFLET);
const isPage = (url) => {
  const path = url.split(/[?#]/)[0];
  return path === scope() || path === `${scope()}index.html`;
};

async function remember(cache, key, response) {
  await cache.put(key, response);
  const keys = await cache.keys();
  // Oldest first. Anything trimmed by mistake is simply downloaded again.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((k) => cache.delete(k)));
}

async function serveVersioned(request) {
  const cache = await caches.open(CACHE);
  // A 'reload' request comes from the integrity check, after a cached copy failed it.
  if (request.cache !== 'reload') {
    const saved = await cache.match(request.url);
    if (saved) return saved;
  }
  const response = await fetch(request);
  if (response.ok) await remember(cache, request.url, response.clone());
  return response;
}

async function fetchPage(cache) {
  const response = await fetch(scope(), { cache: 'no-cache' });
  if (response.ok) await remember(cache, scope(), response.clone());
  return response;
}

async function servePage(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(scope());
  const fresh = fetchPage(cache);
  event.waitUntil(fresh.catch(() => {})); // Finish refreshing even if the saved page wins.
  if (!saved) return fresh;
  const usable = fresh.then((response) => (response.ok ? response : saved), () => saved);
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(saved), FRESH_PAGE_WAIT_MS); });
  return Promise.race([usable, timeout]);
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    if (isPage(request.url)) event.respondWith(servePage(event));
    return;
  }
  if (isVersioned(request.url)) event.respondWith(serveVersioned(request));
  // Everything else, including NASA tiles, goes straight to the network.
});

// The first visit loads before this worker exists, so the page lists what it used.
self.addEventListener('message', (event) => {
  const used = (event.data?.precache ?? []).filter((url) => typeof url === 'string' && isVersioned(url));
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await fetchPage(cache).catch(() => {});
    await Promise.all(used.map(async (url) => {
      if (await cache.match(url)) return;
      const response = await fetch(url, { mode: 'cors' }).catch(() => null);
      if (response?.ok) await remember(cache, url, response);
    }));
  })());
});
