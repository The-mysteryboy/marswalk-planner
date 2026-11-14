#!/usr/bin/env node
// Touch profiler: phone-sized screen, Fast 4G, 4x CPU slowdown, synthetic finger input.
//   node tools/measure_touch.mjs <url> [--runs 3] [--block <pattern>]
import puppeteer, { PredefinedNetworkConditions as P } from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const args = process.argv.slice(2);
const url = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : dflt; };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function probe() {
  const T = (window.__t = { long: [], gaps: [] });
  let realL;
  Object.defineProperty(window, 'L', { configurable: true, get: () => realL, set(v) { realL = v; v.Map.addInitHook(function hook() { window.__map = this; }); } });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) T.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  let last = 0;
  const frame = (now) => {
    if (last && now - last > 50) T.gaps.push([last, now - last]);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function run(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(probe);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const c = P['Fast 4G'];
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: c.latency, downloadThroughput: c.download, uploadThroughput: c.upload });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const blocked = opt('block', null);
  if (blocked) await cdp.send('Network.setBlockedURLs', { urls: [blocked] });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !document.getElementById('btn-demo').disabled && !document.querySelector('[data-refining="true"]'), { timeout: 90000 });
  await sleep(6000);
  const box = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

  const window_ = async (action) => {
    const t0 = await page.evaluate(() => performance.now());
    await action();
    await sleep(300);
    const t1 = await page.evaluate(() => performance.now());
    return page.evaluate((a, b) => {
      const T = window.__t;
      return {
        longest: Math.max(0, ...T.long.filter((e) => e[0] >= a && e[0] < b).map((e) => e[1])),
        slow: T.gaps.filter((g) => g[0] >= a && g[0] < b).length,
        worst: Math.max(0, ...T.gaps.filter((g) => g[0] >= a && g[0] < b).map((g) => g[1])),
        zoom: window.__map.getZoom(),
        center: window.__map.getCenter(),
      };
    }, t0, t1);
  };

  const swipe = async (dx, dy) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + (dx * i) / 20, y: box.y + (dy * i) / 20 }] });
      await sleep(16);
    }
    await sleep(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };

  const before = await page.evaluate(() => window.__map.getCenter());
  const pan = await window_(async () => { await swipe(-120, 0); await swipe(0, -80); await swipe(120, 0); await swipe(0, 80); });
  await swipe(-120, 0);
  const moved = await page.evaluate((b) => Math.abs(window.__map.getCenter().lng - b.lng), before);
  let midZoom = null;
  const pinch = await window_(async () => {
    await cdp.send('Input.synthesizePinchGesture', { x: box.x, y: box.y, scaleFactor: 2, relativeSpeed: 400, gestureSourceType: 'touch' });
    await sleep(500);
    midZoom = await page.evaluate(() => window.__map.getZoom());
    await cdp.send('Input.synthesizePinchGesture', { x: box.x, y: box.y, scaleFactor: 0.5, relativeSpeed: 400, gestureSourceType: 'touch' });
    await sleep(500);
  });
  await ctx.close();
  return { pan, pinch, moved, midZoom };
}

const browser = await puppeteer.launch({ ...CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'mwt-')), args: ['--no-first-run', '--disable-extensions'] });
const runs = [];
for (let i = 0; i < Number(opt('runs', 3)); i++) runs.push(await run(browser));
await browser.close();
for (const key of ['pan', 'pinch']) {
  const r = runs.map((x) => x[key]);
  console.log(`${key}: longest task ${Math.round(median(r.map((x) => x.longest)))} ms, ${median(r.map((x) => x.slow))} slow frames, worst frame ${Math.round(median(r.map((x) => x.worst)))} ms`);
}
console.log(`map really moved: ${runs.every((r) => r.moved > 0.001) ? 'yes' : 'NO'}, pinch zoom reached ${runs.map((r) => r.midZoom).join(', ')}, back to ${runs.map((r) => r.pinch.zoom).join(', ')}`);
