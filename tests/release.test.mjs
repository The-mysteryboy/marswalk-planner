// The promise here: a deploy can never mix old and new files. It rests on every
// file the page names having its content in its name. These tests fail if a file
// was edited without running `npm run release`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assetMap, assetsModule, contentHash, readNormalized, renderPage, versionFiles, versionHash } from '../tools/release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(`${root}index.html`, 'utf8');
const version = html.match(/app\/([0-9a-f]{10})\//)[1];
const localRefs = () => [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|#)/.test(u));

test('release is current: rerunning it would change nothing', () => {
  const files = versionFiles();
  assert.equal(versionHash(files), version, 'js/ or css/ changed. Run: npm run release');
  const page = readNormalized(`${root}index.src.html`).toString('utf8');
  assert.equal(html, renderPage(page, version, assetMap(), files), 'index.src.html changed. Run: npm run release');
  assert.equal(readNormalized(`${root}js/assets.js`).toString('utf8'), assetsModule(assetMap()), 'data/ changed. Run: npm run release');
});

test('the page names only versioned files, and all of them exist', () => {
  const refs = localRefs();
  assert.ok(refs.length >= 10);
  for (const ref of refs) {
    assert.match(ref, new RegExp(`^app/(${version}|assets)/`), `${ref} has no version in its name`);
    assert.ok(existsSync(join(root, ref)), `${ref} is missing`);
  }
  assert.ok(!html.includes('{{'), 'a placeholder was left in the page');
});

test('the version folder is an exact copy of the source', () => {
  const files = versionFiles();
  const folder = `${root}app/${version}`;
  const published = readdirSync(folder, { recursive: true }).map((f) => f.replaceAll('\\', '/'))
    .filter((f) => statSync(join(folder, f)).isFile());
  assert.deepEqual(published.sort(), files.map(([name]) => name).sort());
  for (const [name, source] of files) {
    assert.deepEqual(readFileSync(`${root}app/${version}/${name}`), readNormalized(source), `${name} differs`);
  }
});

test('the page loads scripts and styles only from this site', () => {
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map((m) => m[0]).filter((t) => !t.includes('rel="preconnect"'));
  assert.ok(tags.length >= 10);
  for (const tag of tags) assert.ok(!/(?:href|src)="https?:/.test(tag), tag);
});

test('the vendored Leaflet is 1.9.4, byte for byte, with its license', () => {
  const sri = (name) => `sha512-${createHash('sha512').update(readFileSync(`${root}app/${version}/leaflet/${name}`)).digest('base64')}`;
  for (const name of ['leaflet.min.js', 'leaflet.min.css']) {
    assert.ok(html.includes(`integrity="${sri(name)}"`), `${name} does not match the hash the page names`);
  }
  assert.ok(readFileSync(`${root}vendor/leaflet/leaflet.min.js`, 'utf8').includes('"1.9.4"'));
  const license = readFileSync(`${root}vendor/leaflet/LICENSE`, 'utf8');
  assert.ok(license.startsWith('BSD 2-Clause License'));
  assert.ok(!license.includes('\r'), 'LICENSE has no extension, so the release hashes its line endings as they are');
  assert.deepEqual(readFileSync(`${root}app/${version}/leaflet/LICENSE`, 'utf8'), license);
  for (const image of ['layers', 'layers-2x', 'marker-icon']) assert.ok(existsSync(`${root}app/${version}/leaflet/images/${image}.png`));
});

test('Leaflet is a plain script, so it gets no module preload', () => {
  assert.ok(html.includes(`<script src="app/${version}/leaflet/leaflet.min.js"`));
  assert.ok(!html.includes(`modulepreload" href="app/${version}/leaflet/`));
});

test('the page says so if the map library never arrives', () => {
  assert.ok(html.includes(`"The map couldn't load. Reload the page."`));
});

test('every asset name matches the hash of its content', () => {
  for (const [name, target] of Object.entries(assetMap())) {
    const body = readFileSync(join(root, target));
    assert.ok(basename(target).includes(`.${contentHash(body)}.`), `${target} does not match its content`);
    assert.deepEqual(body, readNormalized(`${root}data/${name}`), `${name} differs from its published copy`);
  }
});

test('a changed file gets a new name, so a cache cannot return the old content', () => {
  assert.notEqual(contentHash(Buffer.from('one')), contentHash(Buffer.from('two')));
});

test('hashes ignore Windows line endings, so every machine stamps the same name', () => {
  assert.equal(contentHash(Buffer.from('a\nb\n')), contentHash(Buffer.from('a\r\nb\r\n'.replace(/\r\n/g, '\n'))));
});

test('a placeholder for a file that does not exist stops the release', () => {
  assert.throws(() => renderPage('{{asset:missing.bin}}', 'abc', {}, []), /missing\.bin/);
});
