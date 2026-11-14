// Runs the real sw.js against stand-in browser APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCOPE = 'https://site.test/marswalk-planner/';
const APP_FILE = `${SCOPE}app/abc123/main.js`;
const source = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

function worker({ network = {}, delayMs = 0, saved = {} } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(saved));
  const calls = [];
  const cache = {
    match: async (key) => store.get(typeof key === 'string' ? key : key.url),
    put: async (key, value) => { store.set(key, value); },
    keys: async () => [...store.keys()],
    delete: async (key) => store.delete(key),
  };
  const sandbox = {
    self: {
      registration: { scope: SCOPE },
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} },
    fetch: async (target, options) => {
      const url = typeof target === 'string' ? target : target.url;
      calls.push({ url, options });
      if (delayMs) await new Promise((r) => { setTimeout(r, delayMs); });
      if (!(url in network)) throw new Error('offline');
      return network[url].clone();
    },
  };
  new Function('self', 'caches', 'fetch', source)(sandbox.self, sandbox.caches, sandbox.fetch);
  const dispatch = (request) => {
    let answer = null;
    listeners.fetch({ request: { method: 'GET', ...request }, respondWith: (p) => { answer = p; }, waitUntil: () => {} });
    return answer;
  };
  return { dispatch, calls, store, listeners };
}

const text = (body, status = 200) => new Response(body, { status });

test('NASA tiles are left alone', () => {
  const { dispatch } = worker();
  assert.equal(dispatch({ url: 'https://trek.nasa.gov/tiles/Mars/EQ/x/1.0.0/default/default028mm/11/813/2928.png', mode: 'no-cors' }), null);
});

test('other pages on the site are left alone', () => {
  const { dispatch } = worker();
  assert.equal(dispatch({ url: `${SCOPE}tests/terrain_check.html`, mode: 'navigate' }), null);
  assert.equal(dispatch({ url: `${SCOPE}README.md`, mode: 'navigate' }), null);
});

test('non-GET requests are left alone', () => {
  const { dispatch } = worker();
  assert.equal(dispatch({ url: APP_FILE, mode: 'cors', method: 'POST' }), null);
});

test('a versioned file is served from the cache without touching the network', async () => {
  const { dispatch, calls } = worker({ saved: { [APP_FILE]: text('saved') } });
  const res = await dispatch({ url: APP_FILE, mode: 'cors' });
  assert.equal(await res.text(), 'saved');
  assert.equal(calls.length, 0);
});

test('a versioned file is cached the first time it is fetched', async () => {
  const { dispatch, store } = worker({ network: { [APP_FILE]: text('body') } });
  await dispatch({ url: APP_FILE, mode: 'cors' });
  assert.ok(store.has(APP_FILE));
});

test('a failed download is not cached', async () => {
  const { dispatch, store } = worker({ network: { [APP_FILE]: text('nope', 404) } });
  await dispatch({ url: APP_FILE, mode: 'cors' });
  assert.ok(!store.has(APP_FILE));
});

test('the integrity retry skips the cache and replaces the damaged copy', async () => {
  const { dispatch, store } = worker({
    saved: { [APP_FILE]: text('damaged') },
    network: { [APP_FILE]: text('good') },
  });
  const res = await dispatch({ url: APP_FILE, mode: 'cors', cache: 'reload' });
  assert.equal(await res.text(), 'good');
  assert.equal(await store.get(APP_FILE).text(), 'good');
});

test('first visit: the page comes from the network', async () => {
  const { dispatch } = worker({ network: { [SCOPE]: text('new page') } });
  assert.equal(await (await dispatch({ url: SCOPE, mode: 'navigate' })).text(), 'new page');
});

test('repeat visit, fast network: a new deploy shows at once', async () => {
  const { dispatch, calls } = worker({ saved: { [SCOPE]: text('old page') }, network: { [SCOPE]: text('new page') } });
  assert.equal(await (await dispatch({ url: `${SCOPE}?x=1`, mode: 'navigate' })).text(), 'new page');
  assert.equal(calls[0].options.cache, 'no-cache', 'must not accept a copy from the HTTP cache');
});

test('repeat visit, slow network: the saved page opens, and the new one is kept', async () => {
  const { dispatch, store } = worker({ saved: { [SCOPE]: text('old page') }, network: { [SCOPE]: text('new page') }, delayMs: 600 });
  const started = Date.now();
  const res = await dispatch({ url: SCOPE, mode: 'navigate' });
  assert.equal(await res.text(), 'old page');
  assert.ok(Date.now() - started < 550, 'should not wait for the slow network');
  await new Promise((r) => { setTimeout(r, 700); }); // Longer than the network delay.
  assert.equal(await store.get(SCOPE).text(), 'new page');
});

test('repeat visit, offline: the saved page still opens', async () => {
  const { dispatch } = worker({ saved: { [SCOPE]: text('old page') } });
  assert.equal(await (await dispatch({ url: SCOPE, mode: 'navigate' })).text(), 'old page');
});

test('repeat visit, server error: the saved page opens', async () => {
  const { dispatch } = worker({ saved: { [SCOPE]: text('old page') }, network: { [SCOPE]: text('down', 500) } });
  assert.equal(await (await dispatch({ url: SCOPE, mode: 'navigate' })).text(), 'old page');
});

test('precache keeps only versioned files', async () => {
  // The old address: a page saved before Leaflet moved to this site still asks for it.
  const leaflet = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const tile = 'https://trek.nasa.gov/tiles/x.png';
  const { listeners, store } = worker({ network: { [SCOPE]: text('page'), [APP_FILE]: text('a'), [leaflet]: text('b'), [tile]: text('c') } });
  let done;
  listeners.message({ data: { precache: [APP_FILE, leaflet, tile, 42] }, waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual([...store.keys()].sort(), [SCOPE, leaflet, APP_FILE].sort());
});
