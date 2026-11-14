// index.html lists files for the browser to fetch early. A new module that is not
// listed would silently bring back a slow load, so check the published page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOADED_LATER } from '../tools/release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(`${root}index.html`, 'utf8');
const hrefs = (rel) => [...html.matchAll(new RegExp(`<link rel="${rel}"[^>]*href="([^"]+)"`, 'g'))].map((m) => m[1]);

test('every JS module is listed as a modulepreload, except those loaded on first use', () => {
  const version = html.match(/app\/([0-9a-f]{10})\//)[1];
  const listed = hrefs('modulepreload').sort();
  const files = readdirSync(`${root}js`).filter((f) => f.endsWith('.js') && !LOADED_LATER.includes(f)).map((f) => `app/${version}/${f}`).sort();
  assert.deepEqual(listed, files);
});

test('the first view does not import the code loaded on first use', () => {
  const main = readFileSync(`${root}js/main.js`, 'utf8');
  for (const name of LOADED_LATER) {
    assert.ok(!main.match(new RegExp(`^import .* from './${name}'`, 'm')), `${name} is imported at the top of main.js`);
    assert.ok(main.includes(`import('./${name}')`), `${name} is never loaded`);
  }
});

test('every preloaded file exists', () => {
  const listed = hrefs('preload');
  assert.ok(listed.length > 0);
  for (const href of listed) assert.ok(existsSync(`${root}${href}`), `${href} is missing`);
});

test('preloaded data uses crossorigin, or fetch() would download it twice', () => {
  for (const tag of html.match(/<link rel="preload" as="fetch"[^>]*>/g)) assert.match(tag, /crossorigin/);
});

test('the report grid is not preloaded, so the preview always lands first', () => {
  assert.ok(hrefs('preload').some((h) => h.includes('terrain_coarse')));
  assert.ok(!hrefs('preload').some((h) => h.includes('terrain_full')));
});
