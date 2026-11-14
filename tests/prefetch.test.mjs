import test from 'node:test';
import assert from 'node:assert/strict';
import { TilePrefetcher, linkIsSlow, tileUrls } from '../js/prefetch.js';

const layer = { url: 'T/{z}/{y}/{x}', bounds: [[-90, -180], [90, 180]], maxNativeZoom: 12 };
const pick = (urls) => urls.map((u) => u.slice(2));

test('tiles: one tile at zoom 0 spans 180 degrees', () => {
  assert.deepEqual(pick(tileUrls(layer, { west: 10, east: 20, south: 10, north: 20 }, 0)), ['0/0/1']);
});

test('tiles: a view across the grid line takes both columns, by hand', () => {
  assert.deepEqual(pick(tileUrls(layer, { west: -10, east: 10, south: 10, north: 20 }, 0)), ['0/0/0', '0/0/1']);
});

test('tiles: a ring widens the range on every side, inside the world', () => {
  // At zoom 1 tiles span 90 degrees. Column 2 and row 0, widened by one, stay in range.
  const urls = pick(tileUrls(layer, { west: 10, east: 20, south: 10, north: 20 }, 1, 1));
  assert.deepEqual(urls, ['1/0/1', '1/0/2', '1/0/3', '1/1/1', '1/1/2', '1/1/3']);
});

test('tiles: zoom is capped at what the layer actually has', () => {
  const urls = tileUrls({ ...layer, maxNativeZoom: 7 }, { west: 10, east: 10.1, south: 10, north: 10.1 }, 11);
  assert.ok(urls.every((u) => u.startsWith('T/7/')));
});

test('tiles: a ring never reaches past the layer coverage', () => {
  const small = { ...layer, bounds: [[18, 77], [18.5, 77.5]] };
  const view = { west: 77.1, east: 77.2, south: 18.1, north: 18.2 };
  const urls = tileUrls(small, view, 9, 5);
  const span = 180 / 512;
  for (const u of urls) {
    const [, , y, x] = u.split('/').map(Number);
    assert.ok(x * span - 180 + span > 77 && x * span - 180 < 77.5, u);
    assert.ok(90 - y * span > 18 && 90 - (y + 1) * span < 18.5, u);
  }
});

test('tiles: a view outside the layer asks for nothing', () => {
  const small = { ...layer, bounds: [[18, 77], [18.5, 77.5]] };
  assert.deepEqual(tileUrls(small, { west: 0, east: 1, south: 0, north: 1 }, 9, 2), []);
});

function fakeLoader() {
  const started = [];
  const finish = [];
  const load = (url) => {
    started.push(url);
    return new Promise((resolve) => { finish.push(resolve); });
  };
  return { load, started, finish };
}
const tick = () => new Promise((r) => { setImmediate(r); });

test('queue: never runs more than its limit at once', async () => {
  const { load, started, finish } = fakeLoader();
  const p = new TilePrefetcher(load, 2);
  p.replace(['a', 'b', 'c']);
  assert.deepEqual(started, ['a', 'b']);
  finish[0]();
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('queue: new work replaces what is still waiting', async () => {
  const { load, started, finish } = fakeLoader();
  const p = new TilePrefetcher(load, 1);
  p.replace(['a', 'b']);
  p.replace(['c']);
  finish[0]();
  await tick();
  assert.deepEqual(started, ['a', 'c']);
});

test('queue: a URL is only ever fetched once', async () => {
  const { load, started, finish } = fakeLoader();
  const p = new TilePrefetcher(load, 5);
  p.replace(['a', 'a', 'b']);
  finish.forEach((f) => f());
  await tick();
  p.replace(['a', 'b', 'c']);
  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('slow link: judged by throughput, whatever the file size', () => {
  const grid = 1_900_000;
  assert.equal(linkIsSlow(grid, 3500), false, 'Fast 4G');
  assert.equal(linkIsSlow(grid, 20000), true, 'Fast 3G');
  assert.equal(linkIsSlow(4_600_000, 7000), false, 'a bigger file on a fast link');
  assert.equal(linkIsSlow(250_000, 1000), false, 'exactly at the limit');
});

test('slow link: a file from a cache proves nothing', () => {
  assert.equal(linkIsSlow(0, 5), false);
  assert.equal(linkIsSlow(0, 0), false);
});

test('queue: clear drops everything waiting', async () => {
  const { load, started, finish } = fakeLoader();
  const p = new TilePrefetcher(load, 1);
  p.replace(['a', 'b']);
  p.clear();
  finish[0]();
  await tick();
  assert.deepEqual(started, ['a']);
});
