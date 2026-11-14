#!/usr/bin/env node
// Map interaction profiler. Drives the real page and measures how each action feels.
//   node tools/measure_map.mjs <url> <out.json> [--runs 3] [--profiles none,fast4g,fast4g-cpu4] [--block <pattern>]
//   node tools/measure_map.mjs --table <out.json>
// --quick stops after the first view and terrain load.
// A cold browser context is used for each run. Leaflet is hooked from outside the
// app, so no app code changes to allow this.
import puppeteer, { PredefinedNetworkConditions as P } from 'puppeteer-core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : dflt; };

const PROFILES = {
  none: { label: 'No throttling', cond: null, cpu: 1 },
  fast4g: { label: 'Fast 4G', cond: P['Fast 4G'], cpu: 1 },
  'fast4g-cpu4': { label: 'Fast 4G + 4x CPU', cond: P['Fast 4G'], cpu: 4 },
};

// Keys match js/layers.js. `watch` is text found in that layer's tile URLs.
const OVERLAYS = [
  ['hirise', 'JEZ_hirise_soc_006'],
  ['ctx6', 'JEZ_ctx_B_soc_008'],
  ['themisDay', 'THEMIS_DayIR'],
  ['themisNight', 'THEMIS_NightIR'],
];
const VECTORS = [['hydrous', 'path.leaflet-interactive'], ['rover', 'path'], ['stops', '.pin-stop']];
const BASES = [['blend', 1, 'Mars_MOLA_blend200ppx'], ['mola', 2, 'Mars_MGS_MOLA_ClrShade'], ['ctx', 0, 'Jezero_CTX_BlockAdj']];

// Runs in the page before any of its scripts.
function probe() {
  const T = (window.__t = { long: [], gaps: [], blank: [], black: [], base: 'Jezero_CTX_BlockAdj', mutated: 0 });
  const BASE_TEXT = ['Jezero_CTX_BlockAdj', 'Mars_MOLA_blend200ppx', 'Mars_MGS_MOLA_ClrShade'];
  let realL;
  Object.defineProperty(window, 'L', {
    configurable: true,
    get: () => realL,
    set(v) { realL = v; v.Map.addInitHook(function hook() { window.__map = this; }); },
  });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) T.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });

  const open = { blank: null, black: null };
  const track = (kind, on, now, frac) => {
    if (on && open[kind] === null) open[kind] = { start: now, frac };
    if (on && frac > open[kind].frac) open[kind].frac = frac;
    if (!on && open[kind] !== null) { T[kind].push([open[kind].start, now, open[kind].frac]); open[kind] = null; }
  };

  // What the viewer sees: sample a grid of points over the map on every frame.
  const coverage = () => {
    const el = document.getElementById('map');
    if (!el || !window.__map) return null;
    const box = el.getBoundingClientRect();
    const tiles = [];
    for (const img of document.querySelectorAll('.leaflet-tile-pane img')) {
      // Any base map counts as live imagery, so a layer kept during a switch is not a blank.
      if (BASE_TEXT.some((b) => img.src.includes(b)) && img.classList.contains('leaflet-tile-loaded') && img.naturalWidth > 1) tiles.push(img.getBoundingClientRect());
    }
    const under = document.querySelector('.leaflet-image-layer');
    const u = under && under.complete && under.naturalWidth > 1 ? under.getBoundingClientRect() : null;
    let total = 0; let noLive = 0; let nothing = 0;
    for (let i = 0.5; i < 12; i++) {
      for (let j = 0.5; j < 8; j++) {
        const x = box.left + (box.width * i) / 12;
        const y = box.top + (box.height * j) / 8;
        total += 1;
        if (tiles.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
        noLive += 1;
        if (!u || x < u.left || x > u.right || y < u.top || y > u.bottom) nothing += 1;
      }
    }
    return { noLive: noLive / total, nothing: nothing / total };
  };

  let last = 0;
  const frame = (now) => {
    if (last && now - last > 50) T.gaps.push([last, now - last]);
    last = now;
    const c = coverage();
    if (c) {
      track('blank', c.noLive > 0.05, now, c.noLive);
      track('black', c.nothing > 0.05, now, c.nothing);
    }
    const m = window.__map;
    if (T.firstPaint === undefined && document.querySelector('.leaflet-image-layer')?.naturalWidth > 1) T.firstPaint = now;
    if (T.firstPaint === undefined && document.querySelector('.leaflet-tile-loaded')) T.firstPaint = now;
    if (m && T.sharp === undefined) {
      m.eachLayer((l) => {
        if (l._url?.includes(T.base) && !l.isLoading() && Object.keys(l._tiles).length) T.sharp = now;
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__layer = (text) => { let f = null; window.__map.eachLayer((l) => { if (l._url?.includes(text)) f = l; }); return f; };

  // Resolves with timings for one tile layer after an action that started at t0.
  window.__watchTiles = (text, t0, timeout) => new Promise((resolve) => {
    let visible = null;
    let feedback = null;
    const tick = () => {
      const now = performance.now();
      const shown = [...document.querySelectorAll(`.leaflet-tile-pane img[src*="${text}"]`)].some((i) => i.classList.contains('leaflet-tile-loaded') && i.naturalWidth > 1);
      if (shown && visible === null) visible = now - t0;
      const busy = document.querySelector('[data-layer-busy="true"]');
      if (feedback === null && busy && Number(getComputedStyle(busy).opacity) > 0.5) feedback = now - t0;
      const layer = window.__layer(text);
      const done = layer && !layer.isLoading() && Object.keys(layer._tiles).length > 0;
      if (done || now - t0 > timeout) resolve({ visible, feedback: feedback ?? visible, sharp: done ? now - t0 : null });
      else setTimeout(tick, 16);
    };
    tick();
  });

  window.__afterPaint = (fn) => new Promise((resolve) => {
    const t0 = performance.now();
    fn();
    const sync = performance.now() - t0;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({ sync, painted: performance.now() - t0 })));
  });
}

const median = (a) => { const s = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function run(browser, url, profile) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(probe);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  if (profile.cond) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.cond.latency, downloadThroughput: profile.cond.download, uploadThroughput: profile.cond.upload });
  }
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const blocked = opt('block', null);
  if (blocked) await cdp.send('Network.setBlockedURLs', { urls: [blocked] });

  const reqs = new Map();
  let seq = 0;
  cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.includes('trek.nasa.gov')) reqs.set(e.requestId, { url: e.request.url, n: seq += 1 }); });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) r.canceled = !!e.canceled; });

  const records = [];
  const now = () => page.evaluate(() => performance.now());
  async function step(name, action, fromStart = false) {
    const from = seq;
    const t0 = fromStart ? 0 : await now();
    const result = (await action()) ?? {};
    await sleep(120); // Lets the long task observer report.
    const t1 = await now();
    const stats = await page.evaluate((a, b) => {
      const T = window.__t;
      const within = (list) => list.filter((e) => e[1] > a && e[0] < b);
      const longest = Math.max(0, ...T.long.filter((e) => e[0] >= a - 60 && e[0] < b).map((e) => e[1]));
      return { longest, blank: within(T.blank), black: within(T.black), gaps: T.gaps.filter((g) => g[0] >= a && g[0] < b).map((g) => g[1]) };
    }, t0, t1);
    const fired = [...reqs.values()].filter((r) => r.n > from);
    const spans = (list) => list.map((e) => e[1] - e[0]);
    records.push({
      name,
      ...result,
      longest: Math.round(stats.longest),
      tiles: fired.length,
      cancelled: fired.filter((r) => r.canceled).length,
      dupes: fired.length - new Set(fired.map((r) => r.url)).size,
      blankN: stats.blank.length,
      blankMs: Math.round(Math.max(0, ...spans(stats.blank))),
      blackN: stats.black.length,
      blackMs: Math.round(Math.max(0, ...spans(stats.black))),
      slowFrames: stats.gaps.length,
      worstFrame: Math.round(Math.max(0, ...stats.gaps)),
    });
  }

  // a) First view ------------------------------------------------------------
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await step('First view', async () => {
    await page.waitForFunction(() => window.__t.sharp !== undefined, { timeout: 40000 }).catch(() => {});
    return page.evaluate(() => ({ visible: window.__t.firstPaint, sharp: window.__t.sharp ?? null }));
  }, true);
  await step('Terrain ready', async () => {
    await page.waitForFunction(() => !document.getElementById('btn-demo').disabled && !document.querySelector('[data-refining="true"]'), { timeout: 90000 });
    return {};
  });
  if (args.includes('--quick')) {
    await ctx.close();
    return records;
  }

  const clickOverlay = (id, text, timeout = 15000) => page.evaluate(async (i, t, ms) => {
    const t0 = performance.now();
    document.querySelector(`input[name="overlay-${i}"]`).click();
    return { ...(await window.__watchTiles(t, t0, ms)), click: performance.now() - t0 };
  }, id, text, timeout);
  const clickOff = (id) => page.evaluate((i) => window.__afterPaint(() => document.querySelector(`input[name="overlay-${i}"]`).click()), id);

  // b) Overlays ---------------------------------------------------------------
  for (const [id, text] of OVERLAYS) {
    await step(`Overlay ${id} on`, () => clickOverlay(id, text));
    await step(`Overlay ${id} off`, async () => {
      const r = await clickOff(id);
      return { visible: r.painted };
    });
    await step(`Overlay ${id} on again`, () => clickOverlay(id, text, 8000));
    await page.evaluate((i) => document.querySelector(`input[name="overlay-${i}"]`).click(), id);
    await sleep(200);
  }
  for (const [id, selector] of VECTORS) {
    await step(`Overlay ${id} toggle`, async () => {
      const r = await page.evaluate(async (i, s) => {
        const t0 = performance.now();
        const before = document.querySelectorAll(s).length;
        document.querySelector(`input[name="overlay-${i}"]`).click();
        await new Promise((resolve) => {
          const tick = () => {
            if (document.querySelectorAll(s).length !== before || performance.now() - t0 > 3000) resolve();
            else requestAnimationFrame(tick);
          };
          tick();
        });
        return performance.now() - t0;
      }, id, selector);
      await page.evaluate((i) => document.querySelector(`input[name="overlay-${i}"]`).click(), id);
      return { visible: r };
    });
  }

  // c) Basemaps ---------------------------------------------------------------
  for (const [id, index, text] of BASES) {
    await step(`Basemap ${id}`, () => page.evaluate(async (i, t, ms) => {
      window.__t.base = t;
      const t0 = performance.now();
      document.querySelectorAll('input[name="base"]')[i].click();
      return { ...(await window.__watchTiles(t, t0, ms)), click: performance.now() - t0 };
    }, index, text, 15000));
  }

  // d) Opacity ----------------------------------------------------------------
  await clickOverlay('themisDay', 'THEMIS_DayIR', 8000);
  await step('Opacity slider', () => page.evaluate(async () => {
    const input = document.querySelector('[data-layer="themisDay"] input[type="range"]');
    const times = [];
    for (let v = 75; v >= 15; v -= 5) {
      const r = await window.__afterPaint(() => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); });
      times.push(r.sync);
    }
    const tile = document.querySelector('.leaflet-tile-pane img[src*="THEMIS_DayIR"]')?.closest('.leaflet-layer');
    return { visible: Math.max(...times), applied: tile?.style.opacity };
  }));
  await page.evaluate(() => document.querySelector('input[name="overlay-themisDay"]').click());
  await sleep(200);

  // e) Zoom -------------------------------------------------------------------
  const center = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.45 }; });
  await page.mouse.move(center.x, center.y);
  const settled = (timeout) => page.evaluate((ms) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const l = window.__layer(window.__t.base);
      if ((l && !l.isLoading() && !window.__map._animatingZoom) || performance.now() - t0 > ms) resolve(performance.now() - t0);
      else setTimeout(tick, 30);
    };
    setTimeout(tick, 350);
  }), timeout);
  const wheel = async (deltaY) => { await page.mouse.wheel({ deltaY }); };
  // A person pauses between actions, which is when an app can prepare for the next one.
  const PAUSE_MS = 8000;
  await sleep(PAUSE_MS);
  await step('Zoom one level at a time', async () => {
    const times = [];
    for (const d of [-100, -100, -100, 100, 100, 100, 100, -100]) {
      await wheel(d);
      times.push(await settled(6000));
    }
    return { sharp: median(times), zoom: await page.evaluate(() => window.__map.getZoom()) };
  });
  await step('Fast zoom in and out', async () => {
    // Zooming around another point reaches tiles the browser has not seen yet.
    await page.mouse.move(center.x - 420, center.y + 200);
    for (const d of [-100, -100, -100, 100, 100, 100]) {
      await wheel(d);
      await sleep(180);
    }
    return { sharp: await settled(8000) };
  });

  // f) Pan --------------------------------------------------------------------
  await sleep(PAUSE_MS);
  await step('Pan by dragging', async () => {
    for (const [dx, dy] of [[-300, 0], [0, -220], [300, 0], [0, 220]]) {
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      for (let i = 1; i <= 24; i++) {
        await page.mouse.move(center.x + (dx * i) / 24, center.y + (dy * i) / 24);
        await sleep(16);
      }
      await sleep(150); // Stops the map throwing itself onward.
      await page.mouse.up();
      await sleep(300);
    }
    return { sharp: await settled(6000) };
  });

  // g) Waypoint drag ----------------------------------------------------------
  await page.evaluate(() => document.getElementById('btn-demo').click());
  await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'caution', { timeout: 15000 });
  await sleep(1200);
  await step('Drag a waypoint', async () => {
    const pin = await page.evaluate(() => {
      const pins = [...document.querySelectorAll('.pin-waypoint')];
      const r = pins[pins.length - 1].getBoundingClientRect();
      const T = window.__t;
      T.drag = { mouse: null, markerLag: 0, lineLag: 0, frames: 0, mutated: 0 };
      new MutationObserver(() => { T.drag.mutated = performance.now(); }).observe(document.getElementById('verdict'), { subtree: true, childList: true, characterData: true });
      new MutationObserver(() => { T.drag.mutated = performance.now(); }).observe(document.getElementById('s-time'), { subtree: true, childList: true, characterData: true });
      new MutationObserver(() => { T.drag.mutated = performance.now(); }).observe(document.getElementById('profile-chart'), { subtree: true, childList: true });
      window.addEventListener('mousemove', (e) => { T.drag.mouse = [e.clientX, e.clientY]; }, true);
      let line = null;
      window.__map.eachLayer((l) => { if (l.options?.weight === 3.5 && l.getLatLngs) line = l; });
      const box = document.getElementById('map').getBoundingClientRect();
      const measure = () => {
        const d = T.drag;
        if (d.mouse && !d.stop) {
          d.frames += 1;
          const p = pins[pins.length - 1];
          const current = document.querySelectorAll('.pin-waypoint');
          const m = (current[current.length - 1] ?? p).getBoundingClientRect();
          d.markerLag = Math.max(d.markerLag, Math.hypot(m.left + m.width / 2 - d.mouse[0], m.top + m.height / 2 - d.mouse[1]));
          const end = line.getLatLngs().at(-1);
          const q = window.__map.latLngToContainerPoint(end);
          d.lineLag = Math.max(d.lineLag, Math.hypot(q.x + box.left - d.mouse[0], q.y + box.top - d.mouse[1]));
        }
        requestAnimationFrame(measure);
      };
      measure();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(pin.x, pin.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(pin.x - i * 3, pin.y - i * 2);
      await sleep(16);
    }
    const released = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await page.evaluate(() => { window.__t.drag.stop = true; });
    await sleep(1500);
    return page.evaluate((t) => {
      const d = window.__t.drag;
      const pins = document.querySelectorAll('.pin-waypoint');
      const r = pins[pins.length - 1].getBoundingClientRect();
      return { report: d.mutated > t ? d.mutated - t : 0, markerLag: d.markerLag, lineLag: d.lineLag, frames: d.frames, endX: r.left + r.width / 2, endY: r.top + r.height / 2 };
    }, released).then((r) => ({ ...r, moved: Math.hypot(r.endX - pin.x, r.endY - pin.y) }));
  });

  // The same drag on a 39 km route, where the report has far more to redo each frame.
  const longPlan = 'h=18.44463,77.45089&w=18.3,77.5;18.2,77.7;18.4,77.95;18.6,77.9;18.75,77.6;18.8,77.3;18.6,77.15;18.45,77.3;18.42,77.4&b=ctx&o=rover,stops';
  await page.evaluate((plan) => { window.location.hash = plan; }, longPlan);
  await sleep(1800);
  await step('Drag on a long route', async () => {
    const pin = await page.evaluate(() => {
      const pins = [...document.querySelectorAll('.pin-waypoint')];
      const r = pins[pins.length - 1].getBoundingClientRect();
      window.__t.drag = { mouse: null, markerLag: 0, lineLag: 0, frames: 0, mutated: 0 };
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(pin.x, pin.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(pin.x - i * 2, pin.y - i);
      await sleep(16);
    }
    const released = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await sleep(1800);
    return page.evaluate((t) => {
      const d = window.__t.drag;
      return { report: d.mutated > t ? d.mutated - t : 0, markerLag: d.markerLag, lineLag: d.lineLag, distance: document.getElementById('s-distance').innerText };
    }, released);
  });

  await ctx.close();
  return records;
}

function table(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const names = Object.values(data)[0].runs[0].map((r) => r.name);
  const fmt = (v, unit = '') => (v === null || v === undefined ? '-' : `${Math.round(v)}${unit}`);
  console.log('| Interaction | Condition | Feedback ms | Visible ms | Sharp ms | Longest task | Tiles | Cancelled | Dupes | Blank (no live tile) | Black | Extra |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const name of names) {
    for (const p of Object.values(data)) {
      const rows = p.runs.map((r) => r.find((x) => x.name === name)).filter(Boolean);
      const m = (k) => median(rows.map((r) => r[k]));
      const extra = name.startsWith('Drag')
        ? `moved ${fmt(m('moved'))} px, report ${fmt(m('report'))} ms after release, marker lag ${fmt(m('markerLag'))} px, line lag ${fmt(m('lineLag'))} px, ${fmt(m('slowFrames'))} slow frames, worst ${fmt(m('worstFrame'))} ms`
        : `${fmt(m('slowFrames'))} slow frames, worst ${fmt(m('worstFrame'))} ms`;
      console.log(`| ${name} | ${p.label} | ${fmt(m('feedback'))} | ${fmt(m('visible'))} | ${fmt(m('sharp'))} | ${fmt(m('longest'))} ms | ${fmt(m('tiles'))} | ${fmt(m('cancelled'))} | ${fmt(m('dupes'))} | ${fmt(m('blankN'))} / ${fmt(m('blankMs'))} ms | ${fmt(m('blackN'))} / ${fmt(m('blackMs'))} ms | ${extra} |`);
    }
  }
}

if (args[0] === '--table') {
  table(args[1]);
} else {
  const [url, out] = args;
  const runs = Number(opt('runs', 3));
  const keys = opt('profiles', 'none,fast4g,fast4g-cpu4').split(',');
  const browser = await puppeteer.launch({ ...CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'mwm-')), args: ['--no-first-run', '--disable-extensions'] });
  const results = {};
  for (const key of keys) {
    results[key] = { label: PROFILES[key].label, runs: [] };
    for (let i = 0; i < runs; i++) {
      const t = Date.now();
      try {
        results[key].runs.push(await run(browser, url, PROFILES[key]));
        console.log(`${key} run ${i + 1}: ${Math.round((Date.now() - t) / 1000)} s`);
      } catch (err) {
        console.log(`${key} run ${i + 1} FAILED: ${err.message}`);
      }
      writeFileSync(out, JSON.stringify(results));
    }
  }
  await browser.close();
  console.log('done');
}
