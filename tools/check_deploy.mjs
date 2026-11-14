// Real browser, real service worker, simulated deploys.
//   node tools/check_deploy.mjs <throwaway-copy-of-the-site>
// It edits that copy and re-runs the release, so never point it at the real folder.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const SITE = process.argv[2];
const PORT = 8131;
const BASE = `http://127.0.0.1:${PORT}/`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

let pageDelayMs = 0;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, BASE).pathname);
  const file = join(SITE, path === '/' ? 'index.html' : path);
  const send = () => {
    try {
      statSync(file);
      // Like GitHub Pages: everything may sit in the HTTP cache for 10 minutes.
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  };
  if (path === '/' && pageDelayMs) setTimeout(send, pageDelayMs); else send();
});
await new Promise((r) => { server.listen(PORT, '127.0.0.1', r); });

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

function deploy(marker) {
  const report = join(SITE, 'js', 'report.js');
  writeFileSync(report, `${readFileSync(report, 'utf8')}\n// deploy ${marker}\n`);
  const out = execFileSync(process.execPath, ['tools/release.mjs'], { cwd: SITE, encoding: 'utf8' });
  return out.match(/Release ([0-9a-f]{10})/)[1];
}
const pageVersion = () => readFileSync(join(SITE, 'index.html'), 'utf8').match(/app\/([0-9a-f]{10})\//)[1];

const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'mwu-')), args: ['--no-first-run', '--disable-extensions'],
  defaultViewport: { width: 1280, height: 800 },
});
const ctx = await browser.createBrowserContext();

async function visit({ demo = false } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/trek\.nasa\.gov|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text() + m.location()?.url)) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => { const b = document.getElementById('btn-demo'); return b && !b.disabled && !document.querySelector('[data-refining="true"]'); }, { timeout: 45000 });
  let verdict = null;
  if (demo) {
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'caution', { timeout: 15000 });
    verdict = await page.evaluate(() => `${document.getElementById('verdict-word').textContent} ${document.getElementById('s-slope').innerText.replace('\n', ' ')}`);
  }
  const info = await page.evaluate(() => {
    const names = [
      ...performance.getEntriesByType('resource').map((r) => r.name),
      ...[...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href),
    ];
    const versions = [...new Set(names.flatMap((n) => [...n.matchAll(/\/app\/([0-9a-f]{10})\//g)].map((m) => m[1])))];
    return { versions, controlled: !!navigator.serviceWorker.controller };
  });
  return { page, ...info, verdict, errors };
}

async function waitForCache(page) {
  await page.waitForFunction(async () => {
    const keys = await (await caches.open('marswalk-1')).keys();
    return keys.length >= 16 && keys.some((k) => k.url.includes('terrain_full'));
  }, { timeout: 30000, polling: 250 });
  return page.evaluate(async () => (await (await caches.open('marswalk-1')).keys()).length);
}

// 1. First visit -------------------------------------------------------------
const v1 = pageVersion();
const first = await visit({ demo: true });
await first.page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20000 });
const cached = await waitForCache(first.page);
check('First visit fills the cache', cached >= 16, `${cached} files cached, version ${first.versions.join(',')}`);
await first.page.close();

// 2. Offline repeat proves nothing was left to the network --------------------
const offlinePage = await ctx.newPage();
await offlinePage.setOfflineMode(true);
await offlinePage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await offlinePage.waitForFunction(() => { const b = document.getElementById('btn-demo'); return b && !b.disabled && !document.querySelector('[data-refining="true"]'); }, { timeout: 30000 });
await offlinePage.click('#btn-demo');
await offlinePage.waitForFunction(() => document.getElementById('verdict').dataset.state === 'caution', { timeout: 15000 });
const off = await offlinePage.evaluate(() => `${document.getElementById('verdict-word').textContent} ${document.getElementById('s-slope').innerText.replace('\n', ' ')}`);
check('Works with no network at all', off === 'CAUTION 18.1° at 4.44 km', off);
await offlinePage.close();

// 3. New deploy, good connection ---------------------------------------------
const v2 = deploy('two');
const second = await visit({ demo: true });
check('New deploy shows at once', second.versions.length === 1 && second.versions[0] === v2, `page uses ${second.versions.join(',')}, deployed ${v2}`);
check('Same answer after the update', second.verdict === 'CAUTION 18.1° at 4.44 km', second.verdict);
check('No errors after the update', second.errors.length === 0, second.errors.join(' | ') || 'none');
await second.page.close();

// 4. New deploy, slow connection: the saved page opens, complete and consistent --
const v3 = deploy('three');
pageDelayMs = 1500;
const started = Date.now();
const third = await visit({ demo: true });
const took = Date.now() - started;
pageDelayMs = 0;
check('Slow network opens the saved version, never a mix', third.versions.length === 1 && third.versions[0] === v2, `page uses ${third.versions.join(',')} only, newest is ${v3}, ready in ${took} ms`);
check('Older version still gives the right answer', third.verdict === 'CAUTION 18.1° at 4.44 km', third.verdict);
await new Promise((r) => { setTimeout(r, 2000); });
await third.page.close();

// 5. The next visit picks up the deploy ----------------------------------------
const fourth = await visit({ demo: true });
check('Next visit gets the new deploy', fourth.versions.length === 1 && fourth.versions[0] === v3, `page uses ${fourth.versions.join(',')}`);
await fourth.page.close();

// 6. A stale page with no service worker: the previous version must still exist --
check('Previous version stays published', statSync(join(SITE, 'app', v2)).isDirectory(), `app/${v2} kept after deploying ${v3}. Oldest ${v1} was removed.`);

await browser.close();
server.close();
const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} FAILED` : `\nALL ${results.length} PASSED`);
process.exit(bad ? 1 : 0);
