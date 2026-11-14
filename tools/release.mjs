#!/usr/bin/env node
// Stamps a release, so that a deploy can never mix old and new files.
//   npm run release
//
// Files named here never change content: each name carries a hash of what is in
// it. index.html is the only file that changes between deploys, and it names one
// exact set of files. A browser holding a stale index.html therefore gets an older
// but complete set, never half of each. tests/release.test.mjs fails if this was
// not re-run after an edit.
//
//   data/*            -> app/assets/<name>.<hash>.<ext>
//   js/*, css/*       -> app/<version>/
//   vendor/*          -> app/<version>/, with its folders kept
//   index.src.html    -> index.html
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEXT_TYPES = new Set(['.js', '.css', '.json', '.html']);
const VERSION_IN_PAGE = /app\/([0-9a-f]{10})\//;

export const contentHash = (body) => createHash('sha256').update(body).digest('hex').slice(0, 10);

/** File bytes, with Windows line endings removed so a hash means the same everywhere. */
export function readNormalized(path) {
  const body = readFileSync(path);
  return TEXT_TYPES.has(extname(path)) ? Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n')) : body;
}

export function assetMap(root = ROOT) {
  const assets = {};
  for (const name of readdirSync(join(root, 'data')).sort()) {
    const ext = extname(name);
    const hash = contentHash(readNormalized(join(root, 'data', name)));
    assets[name] = `app/assets/${basename(name, ext)}.${hash}${ext}`;
  }
  return assets;
}

export function assetsModule(assets) {
  return `// Written by tools/release.mjs. Do not edit. Paths are relative to index.html.
export const ASSETS = ${JSON.stringify(assets, null, 2)};
`;
}

/** The files that make up a version, as [published name, source path]. */
export function versionFiles(root = ROOT) {
  const scripts = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
  const vendor = readdirSync(join(root, 'vendor'), { recursive: true })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => statSync(join(root, 'vendor', f)).isFile())
    .sort();
  return [
    ...scripts.map((f) => [f, join(root, 'js', f)]),
    ['style.css', join(root, 'css', 'style.css')],
    ...vendor.map((f) => [f, join(root, 'vendor', f)]),
  ];
}

export function versionHash(files) {
  const hash = createHash('sha256');
  for (const [name, path] of files) hash.update(name).update(readNormalized(path));
  return hash.digest('hex').slice(0, 10);
}

// Loaded on first use, or by the worker, so the first view never fetches them.
export const LOADED_LATER = Object.freeze(['reach.js', 'roverpath.js']);

export function renderPage(template, version, assets, files) {
  const app = `app/${version}`;
  // Only our own files are modules. Vendored scripts sit in folders and load as plain scripts.
  const preloads = files.filter(([name]) => name.endsWith('.js') && !name.includes('/') && !LOADED_LATER.includes(name))
    .map(([name]) => `<link rel="modulepreload" href="${app}/${name}">`).join('\n  ');
  const notice = '<!-- Written by tools/release.mjs from index.src.html. Edit that file instead. -->\n';
  return notice + template
    .replaceAll('{{modulepreloads}}', preloads)
    .replaceAll('{{app}}', app)
    .replace(/\{\{asset:([^}]+)\}\}/g, (_, name) => {
      if (!assets[name]) throw new Error(`index.src.html names ${name}, which is not in data/`);
      return assets[name];
    });
}

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function release() {
  const assets = assetMap();
  for (const [name, target] of Object.entries(assets)) write(join(ROOT, target), readNormalized(join(ROOT, 'data', name)));
  write(join(ROOT, 'js', 'assets.js'), assetsModule(assets));

  const files = versionFiles();
  const version = versionHash(files);
  for (const [name, source] of files) write(join(ROOT, 'app', version, name), readNormalized(source));

  const pagePath = join(ROOT, 'index.html');
  const previous = existsSync(pagePath) ? readFileSync(pagePath, 'utf8').match(VERSION_IN_PAGE)?.[1] : null;
  write(pagePath, renderPage(readNormalized(join(ROOT, 'index.src.html')).toString('utf8'), version, assets, files));

  // A rerun with no changes must not remove the version kept from the last release.
  if (previous === version) {
    console.log(`Release ${version}: no changes`);
    return;
  }

  // Keep the previous version. A browser may hold its index.html for a few more
  // minutes, and that page must still find every file it names.
  const keep = new Set([version, previous, 'assets']);
  for (const dir of readdirSync(join(ROOT, 'app'))) {
    if (!keep.has(dir)) rmSync(join(ROOT, 'app', dir), { recursive: true });
  }
  const wanted = new Set(Object.values(assets).map((p) => basename(p)));
  if (previous && previous !== version && existsSync(join(ROOT, 'app', previous, 'assets.js'))) {
    const old = readFileSync(join(ROOT, 'app', previous, 'assets.js'), 'utf8');
    for (const [, name] of old.matchAll(/app\/assets\/([^"]+)"/g)) wanted.add(name);
  }
  for (const file of readdirSync(join(ROOT, 'app', 'assets'))) {
    if (!wanted.has(file)) rmSync(join(ROOT, 'app', 'assets', file));
  }

  console.log(`Release ${version}: ${files.length} files, ${Object.keys(assets).length} assets${previous && previous !== version ? `, kept ${previous}` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) release();
