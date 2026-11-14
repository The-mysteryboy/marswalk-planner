// Load profiler. Headless Chromium with DevTools network throttling and a cold
// cache for each run.
//   node tools/measure_load.mjs <url> <out.json> [--runs 3] [--profiles fast3g,fast4g,none]
// --persist --aged N: visit, quit the browser, wait N seconds, relaunch and visit again.
// --block <pattern>: block matching URLs, to separate local software from the site.
import puppeteer, { PredefinedNetworkConditions as P } from 'puppeteer-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Uses the installed Chrome, or set CHROME_PATH to any Chromium browser.
const CHROME = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const args = process.argv.slice(2);
const url = args[0];
const outFile = args[1];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : dflt; };
const RUNS = Number(opt('runs', 3));
const AGED = Number(opt('aged', 0));
const SETTLE_MS = Number(opt('settle', 12000));

const PROFILES = {
  fast3g: { label: 'Fast 3G / Slow 4G (1.44 Mbps, 562 ms)', cond: P['Fast 3G'] },
  fast4g: { label: 'Fast 4G (8.1 Mbps, 165 ms)', cond: P['Fast 4G'] },
  none: { label: 'No throttling', cond: null },
};
const chosen = opt('profiles', 'fast3g,fast4g,none').split(',');

// Runs inside the page before any of its scripts.
function probe() {
  const m = (window.__m = { long: [] });
  const mark = (k) => { if (!(k in m)) m[k] = Math.round(performance.now()); };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') m.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) m.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  const tick = () => {
    const d = document;
    if (d.querySelector('.leaflet-control-zoom')) mark('mapObject');
    const img = d.querySelector('.leaflet-image-layer');
    if (img && img.complete && img.naturalWidth > 1) mark('underlay');
    if (d.querySelector('img.leaflet-tile-loaded[src*="trek.nasa.gov"]')) mark('firstTile');
    const b = d.getElementById('btn-demo');
    if (b && !b.disabled) mark('demo');
    const refining = d.querySelector('[data-refining="true"]');
    if (b && !b.disabled && !refining && d.querySelector('.pin-habitat')) mark('fullTerrain');
    setTimeout(tick, 20);
  };
  tick();
}

const applyThrottle = (session, cond) => session.send('Network.emulateNetworkConditions', {
  offline: false, latency: cond.latency, downloadThroughput: cond.download, uploadThroughput: cond.upload,
});

function classify(u) {
  if (u.includes('trek.nasa.gov')) { const m = u.match(/EQ\/([^/]+)\//); return `tile: ${m ? m[1].slice(0, 28) : 'trek'}`; }
  const parsed = new URL(u);
  const site = new URL(url);
  if (parsed.hostname !== site.hostname) return `NOT-SITE ${parsed.hostname}`;
  const p = `/${parsed.pathname.slice(site.pathname.length)}`;
  return p === '/' ? 'index.html' : p.slice(1);
}

async function visit(page, cdp, target, settle) {
  const reqs = new Map();
  let t0 = null;
  const onReq = (e) => {
    if (e.request.url.startsWith('data:')) return;
    t0 ??= e.timestamp;
    if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, start: e.timestamp - t0 });
  };
  const onResp = (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    Object.assign(r, { status: e.response.status, enc: h['content-encoding'] ?? '', cached: e.response.fromDiskCache || false, sw: e.response.fromServiceWorker || false, proto: e.response.protocol });
  };
  const onDone = (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp - t0; r.bytes = e.encodedDataLength; } };
  const onFail = (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp - t0; r.failed = e.errorText; } };
  cdp.on('Network.requestWillBeSent', onReq);
  cdp.on('Network.responseReceived', onResp);
  cdp.on('Network.loadingFinished', onDone);
  cdp.on('Network.loadingFailed', onFail);

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const started = Date.now();
  let demo = null;
  while (Date.now() - started < 120000) {
    demo = await page.evaluate(() => window.__m?.demo ?? null);
    if (demo !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, settle));
  const m = await page.evaluate(() => ({ ...window.__m, nav: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd }));
  cdp.off('Network.requestWillBeSent', onReq); cdp.off('Network.responseReceived', onResp);
  cdp.off('Network.loadingFinished', onDone); cdp.off('Network.loadingFailed', onFail);
  const rows = [...reqs.values()].map((r) => ({ name: classify(r.url), start: Math.round(r.start * 1000), end: r.end ? Math.round(r.end * 1000) : null, bytes: r.bytes ?? 0, status: r.status, enc: r.enc, cached: r.cached, sw: r.sw, proto: r.proto, failed: r.failed }));
  return { m, rows };
}

// --persist: a true return visit. Visit, quit the browser, wait, relaunch on the
// same profile so the disk cache carries over, and visit again.
if (args.includes('--persist')) {
  const key = chosen[0];
  const { label, cond } = PROFILES[key];
  const dir = mkdtempSync(join(tmpdir(), 'mwp-'));
  const open = async () => {
    const b = await puppeteer.launch({ ...CHROME, headless: true, userDataDir: dir, args: ['--no-first-run', '--disable-extensions'], defaultViewport: { width: 1440, height: 900 } });
    // The worker fetches the page itself, so it must be throttled too or a return looks too fast.
    b.on('targetcreated', async (t) => {
      if (t.type() !== 'service_worker' || !cond) return;
      try { const s = await t.createCDPSession(); await s.send('Network.enable'); await applyThrottle(s, cond); } catch { /* it may have exited */ }
    });
    const page = await b.newPage();
    await page.evaluateOnNewDocument(probe);
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    if (cond) await applyThrottle(cdp, cond);
    const blocked = opt('block', null);
    if (blocked) await cdp.send('Network.setBlockedURLs', { urls: [blocked] });
    return { b, page, cdp };
  };
  const first = await open();
  const cold = await visit(first.page, first.cdp, url, SETTLE_MS);
  await first.b.close();
  console.log(`first visit done, browser closed, waiting ${AGED}s (${key})`);
  await new Promise((r) => setTimeout(r, AGED * 1000));
  const second = await open();
  const aged = await visit(second.page, second.cdp, url, 2500);
  await second.b.close();
  writeFileSync(outFile, JSON.stringify({ [key]: { label, cold: [cold], repeat: [], aged: [aged] } }));
  console.log(`done: return visit demo ${aged.m.demo} ms`);
  process.exit(0);
}

const browser = await puppeteer.launch({
  ...CHROME, headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'mw-')),
  args: ['--no-first-run', '--disable-extensions', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const results = {};
for (const key of chosen) {
  const { label, cond } = PROFILES[key];
  results[key] = { label, cold: [], repeat: [], aged: [] };
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.createBrowserContext();
    // Service workers run in their own target, so they need throttling too.
    const onTarget = async (t) => {
      if (t.type() !== 'service_worker' || !cond) return;
      try { const s = await t.createCDPSession(); await s.send('Network.enable'); await applyThrottle(s, cond); } catch { /* it may have exited */ }
    };
    ctx.on('targetcreated', onTarget);
    const page = await ctx.newPage();
    await page.evaluateOnNewDocument(probe);
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    if (cond) await applyThrottle(cdp, cond);

    const cold = await visit(page, cdp, url, SETTLE_MS);
    results[key].cold.push(cold);
    await page.goto('about:blank');
    await new Promise((r) => setTimeout(r, 1500));
    const again = await visit(page, cdp, url, 2500);
    results[key].repeat.push(again);
    if (AGED && run === 0) {
      // A returning visitor opens a new tab. The old tab stays open on a blank page,
      // because closing a context's last tab can shut the browser down.
      await page.goto('about:blank');
      console.log(`waiting ${AGED}s for the page cache to expire (${key})`);
      const deadline = Date.now() + AGED * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, Math.min(20000, deadline - Date.now())));
        await browser.version(); // Heartbeat, so a dead browser shows up now, not after the wait.
      }
      const later = await ctx.newPage();
      await later.evaluateOnNewDocument(probe);
      const laterCdp = await later.createCDPSession();
      await laterCdp.send('Network.enable');
      if (cond) await applyThrottle(laterCdp, cond);
      results[key].aged.push(await visit(later, laterCdp, url, 2500));
    }
    await ctx.close();
    console.log(`${key} run ${run + 1}: cold demo ${cold.m.demo} ms, repeat ${again.m.demo} ms`);
    writeFileSync(outFile, JSON.stringify(results));
  }
}
await browser.close();
writeFileSync(outFile, JSON.stringify(results));
console.log('done');
