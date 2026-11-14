// Behaviour checks for a deployed or local copy of the site.
//   node tools/verify_site.mjs <base-url-with-trailing-slash> [--basic]
// Exits non-zero if any check fails.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Uses the installed Chrome, or set CHROME_PATH to any Chromium browser.
const CHROME = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const BASE = process.argv[2];
const PLAN = 'h=18.44463,77.45089&w=18.43396,77.44302;18.45263,77.40776;18.45865,77.40592;18.4669,77.4298';
const NOGO = `${BASE}#${PLAN};18.4731,77.4214&b=ctx&o=rover,stops`;
// There and back along the demo, then out again: too long for the 8 h budget.
const LONG = `${BASE}#h=18.44463,77.45089&w=18.43396,77.44302;18.45263,77.40776;18.45865,77.40592;18.4669,77.4298;18.45865,77.40592;18.45263,77.40776;18.43396,77.44302;18.44463,77.45089;18.43396,77.44302;18.45263,77.40776;18.45865,77.40592;18.4669,77.4298&b=ctx&o=rover,stops`;
const OFFMAP = `${BASE}#h=18.44463,77.45089&w=18.45865,77.40592;19.05,77.40&b=ctx&o=rover,stops`;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

const browser = await puppeteer.launch({
  ...CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'mwv-')),
  args: ['--no-first-run', '--disable-extensions'], defaultViewport: { width: 1440, height: 900 },
});

const consoleErrors = [];
async function fresh({ block = [], collect = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (collect) {
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const where = m.location()?.url ?? '';
      // Only the site's own errors count. Local software can inject scripts into any page.
      if (where && !where.startsWith(BASE)) return;
      consoleErrors.push(`console: ${m.text()}`);
    });
  }
  if (block.length) {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: block });
  }
  return { ctx, page };
}

const read = (page) => page.evaluate(() => ({
  word: document.getElementById('verdict-word')?.textContent,
  reasons: [...document.querySelectorAll('#verdict-reasons li')].map((l) => l.textContent),
  sentence: (() => { const p = document.getElementById('route-sentence'); return p && !p.hidden ? p.textContent : ''; })(),
  slope: document.getElementById('s-slope')?.innerText.replace('\n', ' '),
  distance: document.getElementById('s-distance')?.innerText,
  stops: document.getElementById('stops-count')?.textContent,
  refining: !!document.querySelector('[data-refining="true"]'),
  demoDisabled: document.getElementById('btn-demo')?.disabled,
  loadError: !document.getElementById('load-error')?.hidden,
  notice: !document.getElementById('map-notice')?.hidden,
  // The last image layer is the real local image. The first is only a tiny placeholder.
  underlay: (() => { const i = [...document.querySelectorAll('.leaflet-image-layer')].at(-1); return !!(i && i.complete && i.naturalWidth > 100); })(),
  pins: document.querySelectorAll('.pin-waypoint').length,
  walkShown: !document.getElementById('walk')?.hidden,
  turnShown: !document.getElementById('turnback')?.hidden || !!document.querySelector('.pin-turn'),
  science: [document.getElementById('btn-reach')?.textContent, document.getElementById('btn-rover')?.textContent].join(' | '),
  scienceOff: document.getElementById('btn-reach')?.disabled && document.getElementById('btn-rover')?.disabled,
  alongShown: !document.getElementById('science-card')?.hidden || !document.getElementById('science-line')?.hidden,
}));

const ready = (page) => page.waitForFunction(() => {
  const b = document.getElementById('btn-demo');
  return b && !b.disabled && !document.querySelector('[data-refining="true"]');
}, { timeout: 90000 });

let demoSentence = '';

// 1. Page loads --------------------------------------------------------------
{
  const { ctx, page } = await fresh();
  const res = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  const s = await read(page);
  check('Page loads', res.status() === 200 && s.word === 'No route yet' && !s.loadError, `HTTP ${res.status()}, shows "${s.word}"`);

  // 2. Elevation file --------------------------------------------------------
  const info = await page.evaluate(async () => {
    // Whatever the report grid is called in this build, read its name from what the page loaded.
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /terrain_full|elevation_jezero_v2/.test(n) && /\.bin/.test(n));
    const res = await fetch(url);
    return { status: res.status, enc: res.headers.get('content-encoding'), bytes: (await res.arrayBuffer()).byteLength, file: url.split('/').pop() };
  });
  check('Elevation file returns 200', info.status === 200, `${info.file}: HTTP ${info.status}, ${info.bytes} bytes decoded by browser, content-encoding ${info.enc}`);

  // 3. Demo route ------------------------------------------------------------
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 }).catch(() => {});
  await ready(page);
  const d = await read(page);
  check('Demo route gives CAUTION', d.word === 'CAUTION' && d.slope === '18.1° at 4.44 km' && d.distance === '4.83 km', `${d.word}, ${d.slope}, ${d.distance}, ${d.stops} stops`);
  demoSentence = d.sentence;
  await ctx.close();
}

// 4. NO-GO share link --------------------------------------------------------
{
  const { ctx, page } = await fresh();
  await page.goto(NOGO, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state !== 'empty', { timeout: 15000 });
  const s = await read(page);
  check('NO-GO link', s.word === 'NO-GO' && s.slope === '26.7° at 5.13 km' && s.pins === 5, `${s.word}, ${s.slope}, ${s.pins} waypoints`);
  const demoOk = demoSentence.includes('4.83 km each way gets a CAUTION: its steepest slope is 18.1° at 4.44 km, over our assumed caution limit of 15°');
  const nogoOk = s.sentence.includes(`${s.distance} each way gets a NO-GO: its steepest slope is 26.7° at 5.13 km, over our assumed limit of 25°`);
  check('Plain sentence matches the report', demoOk && nogoOk, `"${demoSentence}" / "${s.sentence}"`);

  if (!process.argv.includes('--basic')) {
    await page.click('[data-explain="verdict"]');
    const why = await page.$eval('#explain-body', (el) => el.innerText);
    const line = 'NO-GO: Slope reaches 26.7° at 5.13 km; limit is 25° (assumption).';
    const shortLine = 'Slope reaches 26.7° at 5.13 km; our assumed limit is 25°.';
    const onVerdict = s.reasons[0];
    check('Why? gives the real reason', why.includes(line) && onVerdict === shortLine, `verdict: "${onVerdict}" Why?: "${why.includes(line) ? line : why.slice(0, 80)}"`);

    await page.click('#mode-inspect');
    const box = await page.$eval('#map', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.6 }; });
    await page.mouse.click(box.x, box.y);
    await page.waitForSelector('.inspect-popup', { timeout: 5000 }).catch(() => {});
    const card = await page.evaluate(() => document.querySelector('.inspect-popup')?.innerText ?? '');
    const after = await read(page);
    // The scarp step fails the report, so the cell it crosses must be red on the map.
    await page.evaluate(() => document.querySelector('input[name="overlay-slope"]').click());
    await page.waitForSelector('img.slope-image', { timeout: 30000 }).catch(() => {});
    const slopeMap = await page.evaluate(async () => {
      const img = document.querySelector('img.slope-image');
      if (!img) return null;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0);
      const data = c.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = { green: 0, yellow: 0, red: 0 };
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0x46) counts.green += 1;
        else if (data[i] === 0xff) counts.yellow += 1;
        else if (data[i] === 0xf0) counts.red += 1;
      }
      return { width: img.naturalWidth, height: img.naturalHeight, ...counts };
    });
    check('Slope map draws from the 40 m grid', slopeMap?.width === 1545 && slopeMap?.height === 1481 && slopeMap.red > 0 && slopeMap.green > 0, JSON.stringify(slopeMap));

    check('Inspect reads a point, adds no waypoint', /Elevation\s+-?\d+ m/.test(card) && /Local slope\s+[\d.]+°/.test(card) && after.pins === 5, `${card.replace(/\s+/g, ' ').slice(0, 70)}, ${after.pins} waypoints`);
  }
  await ctx.close();
}

// First view: the essentials, and a Start here banner that stays dismissed --------
if (!process.argv.includes('--basic')) {
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  const seen = () => page.evaluate(() => ({
    banner: getComputedStyle(document.getElementById('start')).display !== 'none',
    demo: document.getElementById('btn-demo').textContent,
    moreOpen: document.getElementById('more-tools').open,
    slopeHidden: document.querySelector('input[name="overlay-slope"]').checkVisibility() === false,
    symbols: document.getElementById('map-symbols').innerText.replace(/\s+/g, ' ').trim(),
    note: document.getElementById('mode-note').innerText,
    purpose: document.getElementById('purpose').innerText,
    tour: document.getElementById('btn-tour').textContent,
    walk: document.getElementById('walk').checkVisibility(),
    hint: document.getElementById('tools-hint').checkVisibility(),
  }));
  const first = await seen();
  await page.click('#btn-start-hide');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  const again = await seen();
  const purpose = 'Check a walk is safe before an astronaut leaves base.';
  check('First view is simple, Start here stays dismissed', first.banner && !first.moreOpen && first.slopeHidden && first.demo === 'Try the demo walk' && !again.banner && first.symbols === 'Your base Science stop' && first.note.includes('elevation and slope') && first.purpose === purpose && first.tour === 'Take the 60-second tour' && !first.walk && !first.hint, `banner ${first.banner} then ${again.banner}, More tools open ${first.moreOpen}, "${first.demo}", "${first.tour}", key "${first.symbols}", "${first.note}", "${first.purpose}"`);
  await ctx.close();
}

// Tour: six steps by keyboard at every size, and it leaves the app as it found it -----
if (!process.argv.includes('--basic')) {
  const tourOpen = (page) => page.evaluate(() => !document.getElementById('tour').hidden || !document.getElementById('tour-ring').hidden);
  const press = async (page, key) => { await page.keyboard.press(key); await new Promise((r) => setTimeout(r, 120)); };
  // The ring must surround the control, and the card must be fully on screen.
  const stepSeen = (page, selector) => page.evaluate((sel) => {
    const box = (el) => el.getBoundingClientRect();
    const t = box(document.querySelector(sel));
    const kept = box(document.querySelector(sel === '.btn-why' ? '#verdict' : sel)); // Why? sits inside the verdict.
    const r = box(document.getElementById('tour-ring'));
    const c = box(document.getElementById('tour'));
    const root = document.documentElement;
    return {
      title: document.getElementById('tour-title').textContent,
      count: document.getElementById('tour-count').textContent,
      ringed: r.left <= t.left && r.top <= t.top && r.right >= t.right && r.bottom >= t.bottom,
      onScreen: t.top >= 0 && t.bottom <= innerHeight,
      cardFits: c.left >= 0 && c.top >= 0 && c.right <= root.clientWidth && c.bottom <= innerHeight,
      covered: !(c.left >= kept.right || c.right <= kept.left || c.top >= kept.bottom || c.bottom <= kept.top),
      sideways: root.scrollWidth - root.clientWidth,
    };
  }, selector);

  const problems = [];
  const expect = (ok, text) => { if (!ok) problems.push(text); };
  const steps = [['#btn-demo', 'Try the demo walk'], ['#verdict', 'The verdict'], ['.btn-why', 'Why?'], ['#mode-inspect', 'Check a point'], ['#scenarios-section > summary', 'Example missions'], ['#more-tools > summary', 'More tools']];

  const phone = (width, height) => [`${width}x${height}`, { width, height, isMobile: true, hasTouch: true }];
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], phone(320, 568), phone(375, 812), phone(414, 896), phone(667, 375)]) {
    const { ctx, page } = await fresh();
    await page.setViewport(viewport);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);

    // Leaving at step 1, by either way out, loads nothing.
    for (const leave of ['Escape', '#tour-skip']) {
      await page.focus('#btn-tour');
      await press(page, 'Enter');
      expect(await tourOpen(page), `${name}: did not open`);
      if (leave === 'Escape') await press(page, 'Escape'); else await page.click(leave);
      const s = await read(page);
      const left = await page.evaluate(() => ({ focus: document.activeElement.id, hash: location.hash }));
      expect(!(await tourOpen(page)) && s.word === 'No route yet' && s.pins === 0 && left.hash === '', `${name}: ${leave} left a change: ${s.word}, ${s.pins} pins, "${left.hash}"`);
      expect(left.focus === 'btn-tour', `${name}: ${leave} left focus on "${left.focus}"`);
    }

    // Tab can leave the card in both directions.
    await page.focus('#btn-tour');
    await press(page, 'Enter');
    await press(page, 'Tab');
    const forward = await page.evaluate(() => document.getElementById('tour').contains(document.activeElement));
    await page.focus('#tour-skip');
    await page.keyboard.down('Shift');
    await press(page, 'Tab');
    await page.keyboard.up('Shift');
    const backward = await page.evaluate(() => document.getElementById('tour').contains(document.activeElement));
    expect(!forward && !backward, `${name}: focus stayed in the card, forward ${forward}, backward ${backward}`);
    expect((await read(page)).pins === 0, `${name}: Tab loaded a route`);
    await new Promise((r) => setTimeout(r, 250));
    expect((await stepSeen(page, '#btn-demo')).cardFits, `${name}: the card left the screen after Tab`);

    // Tab can scroll the page, so start again from the button.
    await press(page, 'Escape');
    await page.focus('#btn-tour');
    await press(page, 'Enter');

    // Enter on Next is the only thing that loads the demo.
    for (let i = 0; i < steps.length; i++) {
      const [selector, title] = steps[i];
      if (i === 1) await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'caution', { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      // The ring moves once a frame, so a late frame on a busy machine is not a fault.
      await page.waitForFunction((sel) => {
        const t = document.querySelector(sel).getBoundingClientRect();
        const r = document.getElementById('tour-ring').getBoundingClientRect();
        return r.left <= t.left && r.top <= t.top && r.right >= t.right && r.bottom >= t.bottom;
      }, { timeout: 1000 }, selector).catch(() => {});
      const seen = await stepSeen(page, selector);
      expect(seen.title === title && seen.count === `Step ${i + 1} of ${steps.length}` && seen.ringed && seen.onScreen && seen.cardFits && !seen.covered && seen.sideways === 0, `${name} step ${i + 1}: ${JSON.stringify(seen)}`);
      await press(page, 'Enter');
    }
    const end = await read(page);
    const after = await page.evaluate(() => ({
      focus: document.activeElement.id,
      inspecting: document.body.classList.contains('is-inspecting'),
      missions: document.getElementById('scenarios-section').open,
      explain: !document.getElementById('explain').hidden,
    }));
    expect(!(await tourOpen(page)) && end.word === 'CAUTION' && end.slope === '18.1° at 4.44 km' && end.pins === 4, `${name}: ended at ${end.word}, ${end.slope}, ${end.pins} pins`);
    expect(after.focus === 'btn-tour' && !after.inspecting && !after.missions && !after.explain, `${name}: left behind ${JSON.stringify(after)}`);

    // Back works, and going back to step 1 never loads the demo over the route.
    await page.focus('#btn-tour');
    await press(page, 'Enter');
    await page.click('#tour-next');
    await page.click('#tour-back');
    const again = await stepSeen(page, '#btn-demo');
    await press(page, 'Escape');
    expect(again.count === `Step 1 of ${steps.length}` && (await read(page)).pins === 4, `${name}: Back gave ${again.count}`);
    await ctx.close();
  }

  // A route already on the map is never replaced, and Escape leaves Check a point on.
  {
    const { ctx, page } = await fresh();
    await page.goto(NOGO, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'nogo', { timeout: 15000 });
    await page.click('#mode-inspect');
    await page.click('#btn-tour');
    await page.click('#tour-next');
    await press(page, 'Escape');
    const s = await read(page);
    const inspecting = await page.evaluate(() => document.body.classList.contains('is-inspecting'));
    expect(s.pins === 5 && s.word === 'NO-GO' && s.slope === '26.7° at 5.13 km', `shared link: ${s.word}, ${s.slope}, ${s.pins} pins`);
    expect(inspecting && !(await tourOpen(page)), `Escape: inspecting ${inspecting}`);
    await ctx.close();
  }
  check('Tour runs six steps by keyboard at every size', problems.length === 0, problems.length ? problems.join(' | ') : 'desktop, 320, 375, 414 and 667x375: ring on each control, card on screen and covering nothing it points at, Tab leaves it, Escape and Skip change nothing, only Next on step 1 loads the demo, a shared route stays');
}

// Scenarios: the goal comes from the real report, on a real click ---------------
if (!process.argv.includes('--basic')) {
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.evaluate(() => {
    document.getElementById('scenarios-section').open = true;
    document.querySelector('[data-scenario="scarp"]').click();
  });
  await page.waitForFunction(() => document.querySelector('.goal-result[data-pass]'), { timeout: 15000 }).catch(() => {});
  const s = await read(page);
  const goal = await page.evaluate(() => document.querySelector('.goal-result')?.innerText ?? '');
  check('Scenario goal matches the report', s.word === 'NO-GO' && s.slope === '26.7° at 5.13 km' && goal.includes('Goal met') && goal.includes('26.7°'), `${s.word}, ${s.slope}. ${goal}`);
  await ctx.close();
}

// Play the walk: its last frame is the report, and the app is left as it was ------
if (!process.argv.includes('--basic')) {
  const key = (page, name) => page.keyboard.press(name);
  const live = (page) => page.evaluate(() => Object.fromEntries(['distance', 'time', 'elevation', 'slope', 'speed', 'steepest', 'status'].map((k) => [k, document.getElementById(`walk-${k}`).textContent])));
  const app = (page) => page.evaluate(() => ({
    hash: location.hash,
    pins: document.querySelectorAll('.pin-waypoint').length,
    word: document.getElementById('verdict-word').textContent,
    slope: document.getElementById('s-slope').innerText,
    eva: document.getElementById('s-eva').firstChild.textContent.trim(),
  }));
  const closed = (page) => page.evaluate(() => ({
    marker: !!document.querySelector('.pin-walker'),
    live: !document.getElementById('walk-live').hidden,
    cursor: document.querySelector('#profile-chart .cross')?.getAttribute('visibility'),
    label: document.getElementById('walk-play').textContent,
    focus: document.activeElement.id,
  }));
  const isClosed = (c) => !c.marker && !c.live && c.cursor === 'hidden' && c.label === 'Play the walk' && c.focus === 'walk-play';
  const finished = (page) => page.waitForFunction(() => document.getElementById('walk-status').textContent.startsWith('Back at base'), { timeout: 30000 }).then(() => true, () => false);
  const loadDemo = async (page, url = BASE, state = 'caution') => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    if (url === BASE) await page.click('#btn-demo');
    await page.waitForFunction((want) => document.getElementById('verdict')?.dataset.state === want, { timeout: 15000 }, state);
    await page.waitForFunction(() => location.hash.length > 1, { timeout: 5000 }); // The link is written just after.
  };

  // The demo, by keyboard, watching every frame.
  {
    const { ctx, page } = await fresh();
    await loadDemo(page);
    const before = await app(page);
    await page.evaluate(() => {
      window.seen = { marker: false, cursor: false, cursorMoves: new Set(), speeds: new Set(), band: false, lineWide: false, words: false };
      const look = () => {
        const s = window.seen;
        s.marker ||= !!document.querySelector('.pin-walker');
        if (document.getElementById('walk-speed').textContent) s.speeds.add(document.getElementById('walk-speed').textContent);
        const cross = document.querySelector('#profile-chart .cross');
        if (cross?.getAttribute('visibility') === 'visible') { s.cursor = true; s.cursorMoves.add(cross.getAttribute('x1')); }
        s.band ||= [...document.querySelectorAll('.steep-band')].some((b) => b.getAttribute('fill-opacity') === '0.75');
        s.lineWide ||= [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-width') === '10');
        s.words ||= document.getElementById('walk-status').textContent.includes('Steep section, over our assumed caution limit of 15°.');
        requestAnimationFrame(look);
      };
      look();
    });
    await page.focus('#walk-play');
    await key(page, 'Enter');
    await page.click('[data-walk-speed="4"]');
    const done = await finished(page);
    const end = await live(page);
    const seen = await page.evaluate(() => ({ ...window.seen, cursorMoves: window.seen.cursorMoves.size, speeds: [...window.seen.speeds] }));
    const after = await app(page);
    const same = JSON.stringify(before) === JSON.stringify(after);
    check('Play the walk ends on the report: demo', done && end.distance === '4.83 km each way' && end.steepest === '18.1° at 4.44 km' && end.time === before.eva && end.status.includes('CAUTION') && same, `${end.distance}, ${end.steepest}, ${end.time}, "${end.status}", app unchanged ${same}`);
    check('Marker, profile cursor, speed and steep section move together', seen.marker && seen.cursor && seen.cursorMoves > 20 && seen.speeds.length > 10 && seen.speeds.every((v) => v === 'Stopped' || /^\d\.\d km\/h$/.test(v)) && seen.band && seen.lineWide && seen.words, `${JSON.stringify({ ...seen, speeds: seen.speeds.length })}, for example ${seen.speeds.slice(0, 3).join(', ')}`);
    await page.focus('#walk-play');
    await key(page, 'Escape');
    const gone = await closed(page);
    const left = await app(page);
    check('Escape stops the walk and leaves the app as it was', isClosed(gone) && JSON.stringify(left) === JSON.stringify(before), JSON.stringify(gone));
    await ctx.close();
  }

  // The NO-GO link: Pause holds still, and changing the route ends the replay.
  {
    const { ctx, page } = await fresh();
    await loadDemo(page, NOGO, 'nogo');
    const before = await app(page);
    await page.click('#walk-play');
    await new Promise((r) => setTimeout(r, 400));
    await page.click('#walk-play');
    const held = await live(page);
    await new Promise((r) => setTimeout(r, 500));
    const stillHeld = await live(page);
    const pausedLabel = await page.$eval('#walk-play', (b) => b.textContent);
    await page.click('[data-walk-speed="16"]');
    await page.click('#walk-play');
    const done = await finished(page);
    const end = await live(page);
    const after = await app(page);
    check('Play the walk ends on the report: NO-GO link', done && end.distance === '5.43 km each way' && end.steepest === '26.7° at 5.13 km' && end.time === before.eva && end.status.includes('NO-GO') && JSON.stringify(after) === JSON.stringify(before), `${end.distance}, ${end.steepest}, ${end.time}, "${end.status}", hash unchanged ${after.hash === before.hash}`);
    await page.click('#walk-play');
    await page.click('#btn-undo');
    await new Promise((r) => setTimeout(r, 400));
    await page.focus('#walk-play');
    const edited = await closed(page);
    check('Pause holds, and a route edit ends the replay', JSON.stringify(held) === JSON.stringify(stillHeld) && pausedLabel === 'Play' && isClosed(edited), `paused at ${held.time}, ${held.distance}, label "${pausedLabel}", after Undo ${JSON.stringify(edited)}`);
    await ctx.close();
  }

  // Reduced motion: nothing moves by itself, and a slider does the stepping.
  {
    const { ctx, page } = await fresh();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await loadDemo(page);
    await page.click('#walk-play');
    const shown = await page.evaluate(() => ({
      play: document.getElementById('walk-play').checkVisibility(),
      speeds: document.getElementById('walk-speeds').checkVisibility(),
      slider: document.activeElement.id,
    }));
    const start = await live(page);
    await new Promise((r) => setTimeout(r, 500));
    const still = await live(page);
    await key(page, 'ArrowRight');
    const stepped = await live(page);
    await key(page, 'End');
    const end = await live(page);
    await key(page, 'Escape');
    const gone = await closed(page);
    check('Reduced motion steps by a slider instead', !shown.play && !shown.speeds && shown.slider === 'walk-slider' && JSON.stringify(start) === JSON.stringify(still) && stepped.time === '1 min' && end.steepest === '18.1° at 4.44 km' && end.status.includes('CAUTION') && isClosed(gone), `${JSON.stringify(shown)}, ${still.time} then ${stepped.time} then ${end.time}, ${end.steepest}`);
    await ctx.close();
  }

  // The turn-back point: in the report, on the map and profile, and obeyed by the player.
  {
    const shown = (page) => page.evaluate(() => ({
      text: document.getElementById('turnback').textContent,
      pin: document.querySelector('.pin-turn')?.textContent ?? '',
      line: !!document.querySelector('.turn-line'),
      label: document.querySelector('.turn-label')?.textContent ?? '',
    }));
    const setBudget = (page, hours) => page.evaluate((value) => {
      const input = [...document.querySelectorAll('.setting')].find((row) => row.textContent.includes('EVA duration available')).querySelector('input');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { max: input.max, value: input.value, hint: input.closest('.setting').textContent };
    }, hours);

    // A route that fits, then the same route with a budget too short to leave base.
    {
      const { ctx, page } = await fresh();
      await loadDemo(page);
      const fits = await shown(page);
      const before = await app(page);
      const field = await setBudget(page, 8);
      await setBudget(page, 0.5);
      await page.waitForFunction(() => document.getElementById('turnback').textContent.startsWith('Even the first'), { timeout: 5000 }).catch(() => {});
      const short = await shown(page);
      const word = (await app(page)).word;
      await page.click('#walk-play');
      const cannot = await finished(page).then(() => live(page));
      await page.click('#walk-stop');
      await setBudget(page, 8);
      await new Promise((r) => setTimeout(r, 400));
      const after = await app(page);
      check('Turn-back point says so when the route fits or cannot start', fits.text === 'The whole round trip fits: 4 h 02 min of our assumed 8 h limit, with 3 h 58 min to spare.' && !fits.pin && !fits.line && short.text.startsWith('Even the first 0.05 km does not fit:') && !short.pin && word === 'NO-GO' && cannot.distance === 'Stayed at base' && cannot.status.startsWith('This walk cannot start: even the first 0.05 km does not fit the assumed time.') && JSON.stringify(after) === JSON.stringify(before) && field.max === '24' && field.hint.includes('ASSUMPTION'), `"${fits.text}" then "${short.text}", ${cannot.distance}, budget max ${field.max}`);
      await ctx.close();
    }

    // A route too long for the budget, played to the end at 16x.
    {
      const { ctx, page } = await fresh();
      await loadDemo(page, LONG, 'nogo');
      const point = await shown(page);
      const before = await app(page);
      const distance = await page.$eval('#s-distance', (e) => e.innerText);
      await page.evaluate(() => {
        window.turn = { first: 0, last: 0, atPause: '', stopped: false };
        const look = (now) => {
          const t = window.turn;
          if (document.getElementById('walk-status').textContent.startsWith('Turn back here: staying longer would use more than the assumed time.')) {
            t.first ||= now;
            t.last = now;
            t.atPause = document.getElementById('walk-distance').textContent;
            t.stopped ||= document.getElementById('walk-speed').textContent === 'Stopped';
          }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      await page.click('#walk-play');
      await page.click('[data-walk-speed="16"]');
      const done = await finished(page);
      const end = await live(page);
      const turn = await page.evaluate(() => window.turn);
      const after = await app(page);
      const atKm = point.text.match(/^Turn back by ([\d.]+) km/)?.[1];
      const whole = `The full route is ${distance} each way and would take ${before.eva}.`;
      const obeyed = done && point.pin === 'Turn back by here' && point.line && point.label === 'Turn back by here' && turn.stopped && turn.last - turn.first >= 1800 && turn.atPause === `${atKm} of ${atKm} km out` && end.distance === `${atKm} km each way, turned back` && end.status.includes(`turned back at ${atKm} km`) && end.status.includes(whole) && end.status.includes('NO-GO') && JSON.stringify(after) === JSON.stringify(before);
      check('Play the walk obeys the turn-back point', obeyed, `"${point.text}" Paused ${Math.round(turn.last - turn.first)} ms at ${turn.atPause}. Ended "${end.status}"`);
      await page.click('#walk-stop');

      await setBudget(page, 24);
      await page.waitForFunction(() => document.getElementById('turnback').textContent.startsWith('The whole round trip fits'), { timeout: 5000 }).catch(() => {});
      const longBudget = await shown(page);
      const linkKept = (await app(page)).hash === before.hash;
      check('A 24 h budget fits the long route and leaves the link alone', longBudget.text.includes('of our assumed 24 h limit') && !longBudget.pin && !longBudget.line && linkKept, `"${longBudget.text}", link unchanged ${linkKept}`);
      await ctx.close();
    }

    // Reduced motion: the slider lands on the turn-back point.
    {
      const { ctx, page } = await fresh();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await loadDemo(page, LONG, 'nogo');
      await page.click('#walk-play');
      const atTurn = await page.evaluate(() => {
        const slider = document.getElementById('walk-slider');
        const seen = [];
        for (let v = 0; v <= Number(slider.max); v++) {
          slider.value = v;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          seen.push(document.getElementById('walk-status').textContent);
        }
        return { message: seen.some((t) => t.startsWith('Turn back here:')), end: seen.at(-1) };
      });
      check('Reduced motion shows the turn-back message on the slider', atTurn.message && atTurn.end.includes('turned back at'), JSON.stringify(atTurn));
      await ctx.close();
    }
  }

  // Phone sizes: the marker, the controls and the numbers all stay on screen together.
  {
    const problems = [];
    for (const [width, height, url, state] of [[320, 568], [375, 667], [414, 896], [667, 375], [320, 568, LONG, 'nogo'], [667, 375, LONG, 'nogo']]) {
      const { ctx, page } = await fresh();
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      await loadDemo(page, url, state);
      await page.click('#walk-play');
      await page.click('[data-walk-speed="16"]');
      // Every frame of the walk, not just one: the marker must never go under the player.
      await page.evaluate(() => {
        window.worst = { walkerHidden: 0, playerOff: 0, stopOff: 0, profile: 9999, sideways: 0, playerH: 0 };
        const box = (el) => el.getBoundingClientRect();
        const look = () => {
          const walker = document.querySelector('.pin-walker');
          if (walker) {
            const w = box(walker);
            const player = box(document.getElementById('walk'));
            const stop = box(document.getElementById('walk-stop'));
            const chart = box(document.getElementById('profile-chart'));
            const root = document.documentElement;
            const under = w.left < player.right && w.right > player.left && w.top < player.bottom && w.bottom > player.top;
            const off = w.top < 0 || w.left < 0 || w.right > root.clientWidth || w.bottom > innerHeight;
            const s = window.worst;
            if (under || off) s.walkerHidden += 1;
            if (player.top < 0 || player.bottom > innerHeight + 1 || player.right > root.clientWidth + 1) s.playerOff += 1;
            if (stop.bottom > innerHeight || stop.right > root.clientWidth) s.stopOff += 1;
            // The last frame is a longer summary, and by then the walk is over.
            if (!document.getElementById('walk-status').textContent.startsWith('Back at base')) s.profile = Math.min(s.profile, Math.round(Math.max(0, Math.min(chart.bottom, player.left > 0 ? innerHeight : player.top) - Math.max(chart.top, 0))));
            s.sideways = Math.max(s.sideways, root.scrollWidth - root.clientWidth);
            s.playerH = Math.max(s.playerH, Math.round(player.height));
          }
          requestAnimationFrame(look);
        };
        look();
      });
      const done = await finished(page);
      const fit = await page.evaluate(() => window.worst);
      const wantProfile = height > 500 ? 90 : 0;
      if (!done || fit.walkerHidden || fit.playerOff || fit.stopOff || fit.sideways > 0 || fit.profile < wantProfile) problems.push(`${width}x${height}: ${JSON.stringify(fit)}`);
      await page.click('#walk-stop');
      const gone = await closed(page);
      if (!isClosed(gone) || await page.evaluate(() => document.body.classList.contains('is-walking'))) problems.push(`${width}x${height} Stop: ${JSON.stringify(gone)}`);
      await ctx.close();
    }
    check('Play the walk fits at phone sizes', problems.length === 0, problems.length ? problems.join(' | ') : '320, 375, 414 and 667x375, plus a turned-back walk at 320 and 667x375, on every frame: marker clear of the player, player and Stop on screen, no sideways scroll, profile in view on an upright phone');
  }
}

// Reachable science and the rover path -------------------------------------------
if (!process.argv.includes('--basic')) {
  const open = (page) => page.evaluate(() => { document.getElementById('scenarios-section').open = true; });
  const reachDone = (page) => page.waitForFunction(() => !document.getElementById('reach-body').hidden, { timeout: 60000 }).then(() => true, () => false);
  const table = (page) => page.evaluate(() => ({
    summary: document.querySelector('.reach-summary')?.textContent ?? '',
    basis: document.querySelector('#reach-body .fine')?.textContent ?? '',
    names: [...document.querySelectorAll('.reach-name th')].map((t) => t.textContent),
    rows: [...document.querySelectorAll('.reach-table tr[data-level]')].map((t) => t.innerText.replace(/\s+/g, ' ')),
    tags: [...document.querySelectorAll('.stop-tag')].map((t) => t.textContent),
    note: document.getElementById('reach-note').textContent,
    status: document.getElementById('reach-status').textContent,
    hidden: document.getElementById('reach-body').hidden,
  }));
  const setValue = (page, label, value) => page.evaluate((name, v) => {
    const input = [...document.querySelectorAll('.setting')].find((row) => row.textContent.includes(name)).querySelector('input');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, label, value);

  // Standard, on a page watched for long tasks, then a route loaded from the table.
  {
    const { ctx, page } = await fresh();
    await page.evaluateOnNewDocument(() => {
      window.longest = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.longest.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    const hashBefore = await page.evaluate(() => location.hash);
    await open(page);
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => { window.longest = []; });
    await page.focus('#btn-reach');
    await page.keyboard.press('Enter');
    const progressed = await page.waitForFunction(() => document.getElementById('reach-status').textContent.startsWith('Checking stop'), { timeout: 5000 }).then(() => true, () => false);
    const done = await reachDone(page);
    const t = await table(page);
    const longest = await page.evaluate(() => Math.max(0, ...window.longest));
    const hashAfter = await page.evaluate(() => location.hash);
    const nine = t.names.length === 9 && t.rows.length === 9 && t.tags.length === 9;
    check('Reachable science gives nine results under Standard', progressed && done && nine && t.summary.startsWith('9 of 9 stops are reachable under our assumed limits.') && t.basis.startsWith('Standard preset:') && t.rows.some((r) => r.includes('Report: CAUTION') && r.includes('8.75 km')) && t.note.includes("not NASA's rover or suit limits") && t.note.includes('guarantees slope only') && hashAfter === hashBefore, `"${t.summary}" ${t.tags.join(', ')}`);
    // A slow task on purpose, to show the watcher would have seen one.
    // It runs from a page timer, because a tool's evaluate call does not count as a page task.
    await page.evaluate(() => { setTimeout(() => { const until = performance.now() + 120; while (performance.now() < until); }, 10); });
    await new Promise((r) => setTimeout(r, 500));
    const watcher = await page.evaluate(() => Math.max(0, ...window.longest));
    check('Reachable science stays off the main thread', longest <= 50 && watcher >= 100, `longest task while checking: ${longest} ms. A deliberate slow task read ${watcher} ms`);

    await page.focus('[data-reach-stop="cometgeyser"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.pin-waypoint').length === 1, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('s-distance')?.innerText === '7.48 km', { timeout: 5000 }).catch(() => {});
    const loaded = await read(page);
    check('A stop in the table loads its route and report, from the keyboard', loaded.pins === 1 && loaded.distance === '7.48 km' && loaded.slope === '10.4° at 2.39 km' && loaded.word === 'GO', `${loaded.word}, ${loaded.distance}, ${loaded.slope}, ${loaded.pins} pin`);

    // A new preset must never leave the old results on show.
    await page.evaluate(() => document.querySelector('[data-preset="cautious"]').click());
    await page.waitForFunction(() => document.getElementById('reach-body').hidden, { timeout: 3000 }).catch(() => {});
    const during = await table(page);
    await reachDone(page);
    const cautious = await table(page);
    const stale = !during.hidden || during.tags.length > 0;
    check('Changing a preset clears the results and checks again', !stale && cautious.basis.startsWith('Cautious preset:') && cautious.summary.startsWith('7 of 9 stops') && cautious.rows.filter((r) => r.includes('does not fit')).length === 2 && cautious.tags.filter((x) => x.includes('over time')).length === 2, `during: hidden ${during.hidden}, "${during.status}". After: "${cautious.summary}"`);

    // A tighter limit than any preset, so the search and "not reachable" both really run.
    await page.evaluate(() => document.querySelector('[data-preset="standard"]').click());
    await page.waitForFunction(() => document.querySelector('#reach-body .fine')?.textContent.startsWith('Standard') && !document.getElementById('reach-body').hidden, { timeout: 60000 }).catch(() => {});
    await setValue(page, 'Caution slope limit', 8);
    await setValue(page, 'No-Go slope limit', 8);
    await page.waitForFunction(() => document.querySelector('#reach-body .fine')?.textContent.startsWith('Custom') && !document.getElementById('reach-body').hidden, { timeout: 60000 }).catch(() => {});
    const custom = await table(page);
    check('Tight limits run the safest route and say not reachable', custom.basis.startsWith('Custom assumptions:') && custom.rows.some((r) => r.includes('by the safest route')) && custom.rows.some((r) => r.includes('not reachable under our assumed slope limit')) && custom.tags.includes('Safest route') && custom.tags.includes('No route'), `"${custom.summary}" ${custom.tags.join(', ')}`);
    await ctx.close();
  }

  // The rover path: its download, its numbers, and its classes under another preset.
  {
    const { ctx, page } = await fresh();
    let bytes = 0;
    page.on('response', async (res) => { if (res.url().includes('rover_slopes')) bytes = (await res.buffer().catch(() => Buffer.alloc(0))).length; });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    const hashBefore = await page.evaluate(() => location.hash);
    await open(page);
    await page.focus('#btn-rover');
    await page.keyboard.press('Enter');
    const shownUp = await page.waitForFunction(() => !document.getElementById('rover-body').hidden, { timeout: 15000 }).then(() => true, () => false);
    const seen = () => page.evaluate(() => ({
      classes: [...document.querySelectorAll('#rover-classes li')].map((l) => l.textContent),
      steepest: document.getElementById('rover-steepest').textContent,
      total: document.getElementById('rover-total').textContent,
      body: document.getElementById('rover-body').innerText,
      key: document.getElementById('rover-key').textContent,
      keyOn: !document.getElementById('rover-key').hidden,
      pressed: document.getElementById('btn-rover').getAttribute('aria-pressed'),
      lines: [...document.querySelectorAll('.leaflet-overlay-pane path')].map((p) => p.getAttribute('stroke')),
    }));
    const standard = await seen();
    const stated = standard.body.includes('Slope only') && standard.body.includes("not NASA's rover or suit limits") && standard.body.includes('smoothed out');
    const greens = standard.lines.filter((c) => c === '#46d39a').length;
    const yellows = standard.lines.filter((c) => c === '#ffec80').length;
    check('Rover path shows its classes, limits and caveats', shownUp && standard.classes[0] === 'Up to 15°: 98.7%, 46.15 km' && standard.classes[1] === 'Over 15° to 25°: 1.3%, 0.60 km' && standard.classes[2] === 'Over 25°: 0.0%, 0.00 km' && standard.steepest === 'Steepest step: 17.7° at 34.90 km along the path.' && standard.total.startsWith('Distance analysed: 46.75 km') && stated && standard.keyOn && standard.pressed === 'true' && greens > 0 && yellows > 0 && bytes > 0 && bytes < 20000, `${standard.classes.join(' | ')}. ${standard.steepest} ${greens} green and ${yellows} yellow lines, ${bytes} bytes before compression`);
    await page.evaluate(() => document.querySelector('[data-preset="cautious"]').click());
    await page.waitForFunction(() => document.querySelector('#rover-classes li')?.textContent.startsWith('Up to 10°'), { timeout: 5000 }).catch(() => {});
    const cautious = await seen();
    await page.evaluate(() => document.querySelector('[data-preset="standard"]').click());
    await page.waitForFunction(() => document.querySelector('#rover-classes li')?.textContent.startsWith('Up to 15°'), { timeout: 5000 }).catch(() => {});
    await page.click('#btn-rover');
    await new Promise((r) => setTimeout(r, 300));
    const off = await seen();
    const hashAfter = await page.evaluate(() => location.hash);
    check('Rover classes follow the preset, and the path turns off', cautious.classes[0] === 'Up to 10°: 93.0%, 43.50 km' && cautious.classes[1] === 'Over 10° to 20°: 7.0%, 3.25 km' && cautious.key.includes('10°') && !off.keyOn && off.pressed === 'false' && !off.lines.includes('#46d39a') && hashAfter === hashBefore, `${cautious.classes.join(' | ')}. After turning off: ${off.lines.length} lines, link unchanged ${hashAfter === hashBefore}`);
    await ctx.close();
  }

  // Phone width: both panels readable, nothing sideways.
  {
    const problems = [];
    for (const [width, height] of [[320, 568], [375, 667]]) {
      const { ctx, page } = await fresh();
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ready(page);
      await open(page);
      await page.click('#btn-reach');
      await reachDone(page);
      await page.click('#btn-rover');
      await page.waitForFunction(() => !document.getElementById('rover-body').hidden, { timeout: 15000 }).catch(() => {});
      const fit = await page.evaluate(() => {
        const root = document.documentElement;
        const table = document.querySelector('.reach-table').getBoundingClientRect();
        const cells = [...document.querySelectorAll('.reach-table td, .reach-table th, #rover-classes li')];
        return {
          sideways: root.scrollWidth - root.clientWidth,
          tableRight: Math.round(table.right),
          width: root.clientWidth,
          smallest: Math.min(...cells.map((c) => parseFloat(getComputedStyle(c).fontSize))),
          clipped: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
          target: Math.round(Math.min(...[...document.querySelectorAll('[data-reach-stop]')].map((b) => b.getBoundingClientRect().height))),
        };
      });
      if (fit.sideways > 0 || fit.tableRight > fit.width || fit.smallest < 12 || fit.clipped > 0) problems.push(`${width}x${height}: ${JSON.stringify(fit)}`);
      await ctx.close();
    }
    check('Both panels read at phone width', problems.length === 0, problems.length ? problems.join(' | ') : '320 and 375: no sideways scroll, table inside the page, text 12 px or larger, nothing clipped');
  }
}

// Phone usability: ways out, More tools, Layers on the map, and touch ------------
if (!process.argv.includes('--basic')) {
  const phoneView = (width, height) => ({ width, height, isMobile: true, hasTouch: true });
  const startDemo = async (page) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 });
    await page.waitForFunction(() => location.hash.length > 1, { timeout: 5000 });
  };
  const snapshot = (page) => page.evaluate(() => ({
    hash: location.hash,
    pins: document.querySelectorAll('.pin-waypoint').length,
    preset: document.querySelector('[data-preset][aria-pressed="true"]')?.dataset.preset ?? '',
    overlays: [...document.querySelectorAll('#overlay-list input:checked')].map((i) => i.name).join(','),
  }));
  const basePos = (page) => page.evaluate(() => {
    const m = document.getElementById('map').getBoundingClientRect();
    const h = document.querySelector('.pin-habitat').getBoundingClientRect();
    return [Math.round(h.left - m.left), Math.round(h.top - m.top)];
  });
  const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
  const hits = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  // Clear and undo, for both science views, at two widths.
  {
    const problems = [];
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['375x667', phoneView(375, 667)]]) {
      const { ctx, page } = await fresh();
      await page.setViewport(viewport);
      await startDemo(page);
      const before = await snapshot(page);
      const expect = (ok, text) => { if (!ok) problems.push(`${name}: ${text}`); };
      await page.evaluate(() => { document.getElementById('scenarios-section').open = true; });
      await page.click('#btn-reach');
      await page.waitForFunction(() => !document.getElementById('reach-body').hidden, { timeout: 60000 });

      await page.click('[data-reach-stop="cometgeyser"]');
      await page.waitForFunction(() => document.querySelectorAll('.pin-waypoint').length === 1, { timeout: 5000 }).catch(() => {});
      const note = await page.evaluate(() => !document.getElementById('reach-route-note').hidden && document.getElementById('reach-route-text').textContent);
      expect(note === 'Showing the route to Comet Geyser (Bunsen Peak).', `note "${note}"`);
      await page.click('#btn-reach-undo');
      await new Promise((r) => setTimeout(r, 700));
      const undone = await snapshot(page);
      expect(undone.pins === 4 && undone.hash === before.hash, `undo gave ${undone.pins} pins, link kept ${undone.hash === before.hash}`);

      await page.click('[data-reach-stop="cheyava"]');
      await page.waitForFunction(() => document.querySelectorAll('.pin-waypoint').length === 1, { timeout: 5000 }).catch(() => {});
      await page.focus('#btn-reach-clear');
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 700));
      const escaped = await page.evaluate(() => ({ body: !document.getElementById('reach-body').hidden, tags: document.querySelectorAll('.stop-tag').length, clear: !document.getElementById('btn-reach-clear').hidden, focus: document.activeElement.id }));
      const afterEscape = await snapshot(page);
      expect(!escaped.body && escaped.tags === 0 && !escaped.clear && escaped.focus === 'btn-reach' && afterEscape.pins === 4 && afterEscape.hash === before.hash, `Escape left ${JSON.stringify(escaped)}, ${afterEscape.pins} pins`);

      await page.click('#btn-reach');
      await page.waitForFunction(() => !document.getElementById('reach-body').hidden, { timeout: 60000 }).catch(() => {});
      const again = await page.evaluate(() => ({ rows: document.querySelectorAll('.reach-table tr[data-level]').length, tags: document.querySelectorAll('.stop-tag').length }));
      expect(again.rows === 9 && again.tags === 9, `reopened with ${again.rows} rows, ${again.tags} labels`);
      await page.click('#btn-reach-clear');
      await new Promise((r) => setTimeout(r, 400));
      const cleared = await page.evaluate(() => ({ body: !document.getElementById('reach-body').hidden, tags: document.querySelectorAll('.stop-tag').length, status: document.getElementById('reach-status').textContent, focus: document.activeElement.id }));
      expect(!cleared.body && cleared.tags === 0 && cleared.status === '' && cleared.focus === 'btn-reach', `Clear left ${JSON.stringify(cleared)}`);

      const view = await basePos(page);
      await page.click('#btn-rover');
      await page.waitForFunction(() => !document.getElementById('rover-body').hidden, { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 600));
      const coloured = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((p) => p.getAttribute('stroke') === '#46d39a').length);
      await page.click('#btn-rover-clear');
      await new Promise((r) => setTimeout(r, 600));
      const off = await page.evaluate(() => ({ lines: [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((p) => p.getAttribute('stroke') === '#46d39a').length, key: !document.getElementById('rover-key').hidden, body: !document.getElementById('rover-body').hidden, focus: document.activeElement.id }));
      const viewBack = await basePos(page);
      expect(coloured > 0 && off.lines === 0 && !off.key && !off.body && off.focus === 'btn-rover' && Math.abs(viewBack[0] - view[0]) <= 1 && Math.abs(viewBack[1] - view[1]) <= 1, `rover clear: ${coloured} lines then ${JSON.stringify(off)}, view ${view} then ${viewBack}`);
      await page.click('#btn-rover');
      await page.waitForFunction(() => !document.getElementById('rover-body').hidden, { timeout: 15000 });
      await page.focus('#btn-rover-clear');
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 500));
      const escapedRover = await page.evaluate(() => !document.getElementById('rover-body').hidden || [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke') === '#46d39a'));
      const after = await snapshot(page);
      expect(!escapedRover && JSON.stringify(after) === JSON.stringify(before), `Escape on rover left it on ${escapedRover}. Before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
      await ctx.close();
    }
    check('Science views clear, undo and reopen at desktop and 375 px', problems.length === 0, problems.length ? problems.join(' | ') : 'route from the table undone, Clear and Escape remove every label and colour, route, link, preset and layers as before, map view put back, both reopen');
  }

  // More tools: its name, and a hint that appears once and stays dismissed.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    const label = await page.$eval('#more-tools > summary', (s) => s.innerText.replace(/\s+/g, ' '));
    const firstView = await page.evaluate(() => document.getElementById('tools-hint').checkVisibility());
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 });
    const shown = await page.evaluate(() => document.getElementById('tools-hint').checkVisibility());
    await page.click('#btn-tools-hint-hide');
    const hidden = await page.evaluate(() => !document.getElementById('tools-hint').checkVisibility());
    await startDemo(page);
    const stays = await page.evaluate(() => !document.getElementById('tools-hint').checkVisibility());
    await ctx.close();
    const second = await fresh();
    await startDemo(second.page);
    await second.page.click('#btn-tools-hint-go');
    const opened = await second.page.evaluate(() => ({ open: document.getElementById('more-tools').open, hint: document.getElementById('tools-hint').checkVisibility(), focus: document.activeElement.matches('#more-tools > summary') }));
    await second.ctx.close();
    check('More tools says what is inside, with a hint shown once', label.startsWith('More tools: layers, slope map, safest route, stops') && !firstView && shown && hidden && stays && opened.open && !opened.hint && opened.focus, `"${label}", first view ${firstView}, after a verdict ${shown}, dismissed ${hidden}, after reload ${!stays}, link opens it ${JSON.stringify(opened)}`);
  }

  // Layers on the map, at every size: placement, the panel, and the two lists in step.
  {
    const problems = [];
    const sizes = [['desktop', { width: 1280, height: 800 }], ['320x568', phoneView(320, 568)], ['375x667', phoneView(375, 667)], ['393x851', phoneView(393, 851)], ['414x896', phoneView(414, 896)], ['851x393', phoneView(851, 393)], ['667x375', phoneView(667, 375)]];
    for (const [name, viewport] of sizes) {
      const { ctx, page } = await fresh();
      await page.setViewport(viewport);
      await startDemo(page);
      await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start' }));
      await new Promise((r) => setTimeout(r, 500));
      const before = await snapshot(page);
      const button = await box(page, '#btn-map-layers');
      const mapBox = await box(page, '#map');
      const others = {};
      for (const sel of ['.map-mode', '.leaflet-control-zoom', '.leaflet-control-attribution', '.leaflet-control-scale', '#map-symbols', '.mode-note']) others[sel] = await box(page, sel);
      const markers = await page.evaluate(() => [...document.querySelectorAll('.pin-waypoint, .pin-habitat')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
      const covered = Object.entries(others).filter(([, b]) => hits(button, b)).map(([k]) => k);
      if (markers.some((m) => hits(button, m))) covered.push('a route marker');
      const inside = button && button.l >= mapBox.l && button.r <= mapBox.r && button.t >= mapBox.t && button.r >= mapBox.r - 20;
      if (!inside || covered.length) problems.push(`${name}: button ${JSON.stringify(button)} covers ${covered.join(', ') || 'nothing'}, top-right ${inside}`);

      await page.click('#btn-map-layers');
      await new Promise((r) => setTimeout(r, 300));
      const panel = await box(page, '#map-layers-panel');
      const bottom = [await box(page, '.leaflet-control-attribution'), await box(page, '.leaflet-control-scale')];
      const count = await page.evaluate(() => document.querySelectorAll('#map-layers-panel input').length);
      if (!panel || panel.b > mapBox.b || panel.l < mapBox.l || bottom.some((b) => hits(panel, b)) || count < 8) problems.push(`${name}: panel ${JSON.stringify(panel)} with ${count} switches`);

      await page.click('#map-layers-panel input[value="stops"]');
      await new Promise((r) => setTimeout(r, 400));
      const stopsOff = await page.evaluate(() => ({ pins: document.querySelectorAll('.pin-stop').length, card: document.querySelector('#overlay-list input[name="overlay-stops"]').checked, open: !document.getElementById('map-layers-panel').hidden }));
      await page.click('#map-layers-panel input[value="stops"]');
      const otherBase = await page.evaluate(() => [...document.querySelectorAll('#map-layers-panel input[name="map-base"]')].find((i) => !i.checked).value);
      await page.click(`#map-layers-panel input[value="${otherBase}"]`);
      await new Promise((r) => setTimeout(r, 200));
      const panelClosed = await page.evaluate(() => document.getElementById('map-layers-panel').hidden);
      if (!panelClosed) problems.push(`${name}: choosing a base map left the panel open`);
      await new Promise((r) => setTimeout(r, 400));
      const baseInCards = await page.evaluate((id) => document.querySelector(`#base-list [data-layer="${id}"] input`).checked, otherBase);
      await page.click('#btn-map-layers');
      await new Promise((r) => setTimeout(r, 200));
      const firstBase = await page.evaluate(() => document.querySelector('#map-layers-panel input[name="map-base"]').value);
      await page.click(`#map-layers-panel input[value="${firstBase}"]`);
      await new Promise((r) => setTimeout(r, 200));
      await page.click('#btn-map-layers');
      await new Promise((r) => setTimeout(r, 200));
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
      const closed = await page.evaluate(() => ({ hidden: document.getElementById('map-layers-panel').hidden, focus: document.activeElement.id, expanded: document.getElementById('btn-map-layers').getAttribute('aria-expanded') }));
      const after = await snapshot(page);
      if (stopsOff.pins !== 0 || stopsOff.card || !stopsOff.open || !baseInCards || !closed.hidden || closed.focus !== 'btn-map-layers' || closed.expanded !== 'false' || after.hash !== before.hash || after.pins !== before.pins) {
        problems.push(`${name}: stops off ${JSON.stringify(stopsOff)}, base in cards ${baseInCards}, Escape ${JSON.stringify(closed)}, link back ${after.hash === before.hash}`);
      }

      // The tour card sits above the button wherever they meet.
      await page.focus('#btn-tour');
      await page.keyboard.press('Enter');
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, i === 1 ? 900 : 350));
        const card = await box(page, '#tour');
        const b = await box(page, '#btn-map-layers');
        if (hits(card, b)) {
          const x = (Math.max(card.l, b.l) + Math.min(card.r, b.r)) / 2;
          const y = (Math.max(card.t, b.t) + Math.min(card.b, b.b)) / 2;
          const top = await page.evaluate((px, py) => document.elementFromPoint(px, py)?.closest('#tour') !== null, x, y);
          if (!top) problems.push(`${name}: the Layers button covers the tour card on step ${i + 1}`);
        }
        await page.keyboard.press(i === 5 ? 'Escape' : 'Enter');
      }

      // And it stays clear of the Play the walk player.
      await page.click('#walk-play');
      await new Promise((r) => setTimeout(r, 600));
      if (hits(await box(page, '#btn-map-layers'), await box(page, '#walk'))) problems.push(`${name}: the Layers button meets the player`);
      await page.click('#walk-stop');
      await ctx.close();
    }
    check('Layers on the map, at every size', problems.length === 0, problems.length ? problems.join(' | ') : 'desktop, 320, 375, 393, 414, 851x393 and 667x375: top-right, clear of the mode switch, zoom, key, scale, credits and route markers; the panel stays above the credits, stays in step with More tools, and Escape closes it; the tour card sits above it; the player never meets it');
  }

  // Touch: in landscape one finger scrolls the page and two move the map. Upright and
  // with a mouse, nothing changes.
  {
    const problems = [];
    for (const [width, height] of [[851, 393], [667, 375], [393, 851], [1280, 800]]) {
      const name = `${width}x${height}`;
      const touchScreen = width !== 1280;
      const landscape = width > height && touchScreen;
      const { ctx, page } = await fresh();
      await page.setViewport(touchScreen ? phoneView(width, height) : { width, height });
      await startDemo(page);
      await new Promise((r) => setTimeout(r, 800));
      const cdp = await page.createCDPSession();
      const spot = (fx, fy) => page.evaluate((a, b) => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width * a, y: Math.max(r.top + 20, Math.min(r.top + r.height * b, innerHeight - 40)) }; }, fx, fy);
      const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      const gesture = async (from, to) => {
        await touch('touchStart', from);
        for (let k = 1; k <= 12; k++) {
          await touch('touchMove', from.map((p, i) => ({ id: p.id, x: p.x + ((to[i].x - p.x) * k) / 12, y: p.y + ((to[i].y - p.y) * k) / 12 })));
          await new Promise((r) => setTimeout(r, 16));
        }
        await touch('touchEnd', []);
        await new Promise((r) => setTimeout(r, 700));
      };
      const top = async () => { await page.evaluate(() => scrollTo(0, 0)); await new Promise((r) => setTimeout(r, 250)); };
      const scrolled = () => page.evaluate(() => Math.round(scrollY));
      const hint = () => page.evaluate(() => !document.getElementById('touch-hint').hidden);

      if (!touchScreen) {
        const a = await basePos(page);
        const s = await spot(0.6, 0.6);
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await page.mouse.move(s.x + 40, s.y - 60, { steps: 8 });
        await page.mouse.up();
        await new Promise((r) => setTimeout(r, 500));
        const b = await basePos(page);
        // Leaflet glides on a little after the release, so the map moves at least the drag.
        if (b[0] - a[0] < 38 || b[0] - a[0] > 90 || b[1] - a[1] > -57 || b[1] - a[1] < -130) problems.push(`${name}: a mouse drag moved the map ${b[0] - a[0]},${b[1] - a[1]}`);
        await ctx.close();
        continue;
      }

      await top();
      let a = await basePos(page);
      let s = await spot(0.6, 0.6);
      await gesture([{ id: 0, ...s }], [{ id: 0, x: s.x, y: s.y - 120 }]);
      let b = await basePos(page);
      const page1 = await scrolled();
      const hint1 = await hint();
      if (landscape && (page1 < 50 || b[1] !== a[1] || !hint1)) problems.push(`${name}: one finger scrolled ${page1}px, map moved ${b[1] - a[1]}, hint ${hint1}`);
      if (!landscape && (page1 !== 0 || b[1] - a[1] !== -120 || hint1)) problems.push(`${name}: one finger should still move the map: scrolled ${page1}px, map moved ${b[1] - a[1]}`);

      if (landscape) {
        await new Promise((r) => setTimeout(r, 2200));
        await top();
        s = await spot(0.6, 0.6);
        await gesture([{ id: 0, ...s }], [{ id: 0, x: s.x, y: s.y - 120 }]);
        if (await hint()) problems.push(`${name}: the hint came straight back`);
      }

      await top();
      a = await basePos(page);
      s = await spot(0.5, 0.6);
      await gesture([{ id: 0, x: s.x - 40, y: s.y }, { id: 1, x: s.x + 40, y: s.y }], [{ id: 0, x: s.x + 20, y: s.y - 50 }, { id: 1, x: s.x + 100, y: s.y - 50 }]);
      b = await basePos(page);
      if (b[0] - a[0] !== 60 || b[1] - a[1] !== -50 || (await scrolled()) !== 0) problems.push(`${name}: two fingers moved the map ${b[0] - a[0]},${b[1] - a[1]}`);

      await top();
      const scaleBefore = await page.$eval('.leaflet-control-scale-line', (e) => e.textContent);
      s = await spot(0.5, 0.6);
      await gesture([{ id: 0, x: s.x - 30, y: s.y }, { id: 1, x: s.x + 30, y: s.y }], [{ id: 0, x: s.x - 110, y: s.y }, { id: 1, x: s.x + 110, y: s.y }]);
      const scaleAfter = await page.$eval('.leaflet-control-scale-line', (e) => e.textContent);
      if (scaleAfter === scaleBefore) problems.push(`${name}: pinch did not zoom`);

      await top();
      const pins = (await snapshot(page)).pins;
      s = await spot(0.3, 0.35);
      await touch('touchStart', [{ id: 0, ...s }]);
      await touch('touchEnd', []);
      await new Promise((r) => setTimeout(r, 700));
      if ((await snapshot(page)).pins !== pins + 1) problems.push(`${name}: a tap did not add a waypoint`);

      await page.click('#mode-inspect');
      await top();
      s = await spot(0.55, 0.5);
      await touch('touchStart', [{ id: 0, ...s }]);
      await touch('touchEnd', []);
      await page.waitForSelector('.leaflet-popup', { timeout: 3000 }).catch(() => {});
      if (!(await page.$('.leaflet-popup'))) problems.push(`${name}: Check a point did not answer a tap`);
      await page.click('#mode-draw');

      const markerTouch = await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-marker-draggable')).touchAction);
      if (markerTouch !== 'none') problems.push(`${name}: a draggable marker would lose the touch (${markerTouch})`);

      await page.click('#walk-play');
      await page.click('[data-walk-speed="16"]');
      const played = await page.waitForFunction(() => document.getElementById('walk-status').textContent.startsWith('Back at base'), { timeout: 30000 }).then(() => true, () => false);
      if (!played) problems.push(`${name}: Play the walk did not finish`);
      await ctx.close();
    }
    check('Landscape: one finger scrolls the page, two move the map', problems.length === 0, problems.length ? problems.join(' | ') : '851x393 and 667x375: one finger scrolls the page and the hint shows once, two fingers pan, pinch zooms, tap adds a waypoint, Check a point answers, markers keep the touch, Play the walk runs; 393x851 one finger still moves the map; a desktop mouse still drags it');
  }
}

// Science along this walk, stop names, passing captions, conditions and About ------
if (!process.argv.includes('--basic')) {
  const phoneView = (width, height) => ({ width, height, isMobile: true, hasTouch: true });
  const demo = async (page, url = BASE, state = 'caution') => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    if (url === BASE) await page.click('#btn-demo');
    await page.waitForFunction((want) => document.getElementById('verdict')?.dataset.state === want, { timeout: 15000 }, state);
  };
  const card = (page) => page.evaluate(() => ({
    line: document.getElementById('science-line').hidden ? '' : document.getElementById('science-line').textContent,
    names: [...document.querySelectorAll('#science-list li .science-name')].map((n) => n.textContent),
    links: [...document.querySelectorAll('#science-list li a')].filter((a) => a.href.startsWith('https://')).length,
    none: document.getElementById('science-none').hidden ? '' : document.getElementById('science-none').textContent,
    shown: !document.getElementById('science-card').hidden,
    count: document.getElementById('stops-count').textContent,
  }));
  const ALONG = ['Octavia E. Butler Landing', 'Wright Brothers Field', 'Brac (Seitah)', 'Rochette (Citadelle)', 'Three Forks Sample Depot', 'Wildcat Ridge', 'Skinner Ridge'];

  // The card and the line, on the demo, the NO-GO link and a walk far from every stop.
  {
    const problems = [];
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['375x667', phoneView(375, 667)]]) {
      const { ctx, page } = await fresh();
      await page.setViewport(viewport);
      await demo(page);
      const d = await card(page);
      if (d.line !== '7 science stops within 2 km of this walk.' || JSON.stringify(d.names) !== JSON.stringify(ALONG) || d.links !== 7 || d.count !== '7' || !d.shown) problems.push(`${name} demo: ${JSON.stringify(d)}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await fresh();
      await demo(page, NOGO, 'nogo');
      const d = await card(page);
      if (d.line !== '7 science stops within 2 km of this walk.' || d.names.length !== 7) problems.push(`NO-GO link: ${JSON.stringify(d)}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await fresh();
      await page.goto(`${BASE}#h=18.30000,77.80000&w=18.28000,77.82000&b=ctx&o=rover,stops`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ready(page);
      await page.waitForFunction(() => !document.getElementById('science-card').hidden, { timeout: 15000 }).catch(() => {});
      const d = await card(page);
      if (d.line !== 'No science stops within 2 km of this walk.' || d.names.length !== 0 || !/^No science stops within 2 km of this walk\. The nearest is .+, \d+\.\d\d km from the route\.$/.test(d.none)) problems.push(`far walk: ${JSON.stringify(d)}`);
      await ctx.close();
    }
    check('Science along this walk lists the near stops in route order', problems.length === 0, problems.length ? problems.join(' | ') : 'demo and NO-GO link: 7 stops within 2 km, matching the existing count, in the order the route passes them, each with its reason and source; a walk far from every stop names the nearest; desktop and 375 px');
  }

  // Stop names show when zoomed in, and a stop answers a tap with its reason and source.
  {
    const { ctx, page } = await fresh();
    await page.setViewport(phoneView(393, 851));
    await demo(page);
    const visible = () => page.evaluate(() => [...document.querySelectorAll('.stop-label')].filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.textContent));
    const far = await visible();
    await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start' }));
    for (let i = 0; i < 3; i++) {
      await page.click('.leaflet-control-zoom-in');
      await new Promise((r) => setTimeout(r, 450));
    }
    const near = await visible();
    const brac = await page.evaluate(() => {
      const pin = [...document.querySelectorAll('.leaflet-marker-icon')].find((m) => m.title === 'Brac (Seitah)');
      if (!pin) return 'not on screen';
      pin.click();
      const pop = document.querySelector('.leaflet-popup-content');
      return pop ? pop.innerText : 'no popup';
    });
    check('Stop names show when zoomed in, and a tap shows why and the source', far.length === 0 && near.length === 9 && near.includes('Brac (Seitah)') && brac.includes('Source:') && brac.length > 60, `at the start ${far.length} names, zoomed in ${near.length}: ${near.slice(0, 3).join(', ')}... Brac: "${brac.slice(0, 70)}"`);
    await ctx.close();
  }

  // Play the walk says when it passes each stop, once and in order, with no total changed.
  {
    const { ctx, page } = await fresh();
    await demo(page);
    await page.evaluate(() => {
      window.captions = [];
      new MutationObserver(() => {
        const el = document.getElementById('walk-caption');
        if (!el.hidden && el.textContent && window.captions.at(-1) !== el.textContent) window.captions.push(el.textContent);
      }).observe(document.getElementById('walk-caption'), { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await page.click('#walk-play');
    await page.click('[data-walk-speed="4"]');
    await page.waitForFunction(() => document.getElementById('walk-status').textContent.startsWith('Back at base'), { timeout: 40000 }).catch(() => {});
    await page.waitForFunction(() => window.captions.length >= 7 && document.getElementById('walk-caption').hidden, { timeout: 30000 }).catch(() => {});
    const seen = await page.evaluate(() => window.captions.map((c) => c.split(':')[0].replace('Passing ', '')));
    const end = await page.evaluate(() => ({ distance: document.getElementById('walk-distance').textContent, time: document.getElementById('walk-time').textContent }));
    const order = ALONG;
    await page.click('#walk-stop');
    await ctx.close();
    const reduced = await fresh();
    await reduced.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await demo(reduced.page);
    await reduced.page.click('#walk-play');
    const steps = await reduced.page.evaluate(() => [...document.querySelectorAll('#walk-passes button')].map((b) => b.textContent));
    await reduced.page.evaluate(() => [...document.querySelectorAll('#walk-passes button')].find((b) => b.textContent.includes('Three Forks')).click());
    const shownStep = await reduced.page.evaluate(() => !document.getElementById('walk-caption').hidden && document.getElementById('walk-caption').textContent);
    await reduced.ctx.close();
    check('Play the walk captions each stop once, in order', JSON.stringify(seen) === JSON.stringify(order) && end.distance === '4.83 km each way' && end.time === '4 h 02 min' && steps.length === 7 && typeof shownStep === 'string' && shownStep.startsWith('Passing Three Forks Sample Depot: '), `captions: ${seen.join(', ')}. Ended ${end.distance}, ${end.time}. Reduced motion: ${steps.length} steps, "${String(shownStep).slice(0, 60)}"`);
  }

  // Conditions: fetched only when the panel opens, labelled, validated, and kept.
  {
    const sample = readFileSync(new URL('../tests/fixtures/msl_weather_sample.json', import.meta.url));
    const broken = JSON.stringify({ soles: [{ ...JSON.parse(sample).soles[0], min_temp: '--' }] });
    const run = async (answer) => {
      const { ctx, page } = await fresh({ collect: false });
      let asked = 0;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (!req.url().includes('mars.nasa.gov/rss/api')) { req.continue().catch(() => {}); return; }
        asked += 1;
        if (answer === 'stall') return; // Never answers, so the page must time out.
        req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: answer }).catch(() => {});
      });
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ready(page);
      await new Promise((r) => setTimeout(r, 1500));
      const atFirstView = asked;
      const openPanel = () => page.evaluate(() => {
        document.getElementById('more-tools').open = true;
        const details = document.getElementById('conditions-body').closest('details');
        details.open = false;
        details.open = true;
      });
      await openPanel();
      await page.waitForFunction(() => { const n = document.getElementById('feed-note'); return n && !n.textContent.startsWith('Checking'); }, { timeout: 12000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      const read1 = await page.evaluate(() => ({
        note: document.getElementById('feed-note')?.hidden ? '' : document.getElementById('feed-note')?.innerText ?? '',
        where: [...document.querySelectorAll('#conditions-body .where')].map((w) => w.textContent),
        radiation: [...document.querySelectorAll('#conditions-body .condition')].find((c) => c.textContent.includes('Surface radiation'))?.textContent ?? '',
      }));
      await openPanel();
      await new Promise((r) => setTimeout(r, 500));
      const result = { atFirstView, asked, ...read1 };
      await ctx.close();
      return result;
    };
    const good = await run(sample);
    const bad = await run(broken);
    const stalled = await run('stall');
    const today = new Date();
    const age = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.UTC(2026, 7, 25)) / 86400000);
    const okGood = good.atFirstView === 0 && good.asked === 1 && good.note.includes(`Latest reported: sol 4995 (2026-08-25), ${age} days ago, from Curiosity's REMS weather feed.`) && good.note.includes("Outreach-grade feed, not science-grade, not live. Curiosity's weather is from Gale Crater, not Jezero.") && good.where.filter((w) => w === 'Measured at Jezero').length === 5 && good.where.includes('Measured at Gale') && good.radiation.includes('Gale');
    const okBad = bad.asked === 1 && bad.note === '';
    const okStall = stalled.asked === 2 && stalled.note.includes('could not be reached');
    check('Conditions fetch only on opening, labelled, validated and kept', okGood && okBad && okStall, `first view asked ${good.atFirstView}, opening twice asked ${good.asked}: "${good.note.split('\n')[0]}". A "--" reading shows "${bad.note}". A stalled feed asked ${stalled.asked} times: "${stalled.note.slice(0, 60)}"`);
  }

  // About says how this answers the challenge.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    await page.click('#btn-about');
    const about = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('#about h3')].find((h) => h.textContent === 'How this answers the challenge');
      return heading ? { items: heading.nextElementSibling.querySelectorAll('li').length, limits: heading.nextElementSibling.nextElementSibling.textContent } : null;
    });
    await ctx.close();
    check('About explains how this answers the challenge', about?.items === 6 && about.limits.includes("not NASA's"), JSON.stringify(about));
  }
}

// Map overlays: nothing sits on anything else, in the states a phone can reach -------
if (!process.argv.includes('--basic')) {
  const phoneView = (width, height) => ({ width, height, isMobile: true, hasTouch: true });
  const LONGEST = 'Cheyava Falls (Bright Angel)';
  // The tour card is on top by design and comes and goes, so only these may meet it.
  const UNDER_TOUR = new Set(['zoom', 'modeSwitch', 'layersBtn', 'scale', 'credits']);
  const overlaps = (page) => page.evaluate((under) => {
    const names = {
      popup: '.leaflet-popup', modeSwitch: '.map-mode', modeNote: '#mode-note', readout: '#readout', legend: '#map-symbols',
      zoom: '.leaflet-control-zoom', layersBtn: '#btn-map-layers', layersPanel: '#map-layers-panel', scale: '.leaflet-control-scale',
      credits: '.leaflet-control-attribution', busy: '#map-busy', touchHint: '#touch-hint', caption: '#walk-caption',
      notice: '#map-notice', tourCard: '#tour', player: '.is-walking #walk',
    };
    const seen = [];
    for (const [name, sel] of Object.entries(names)) {
      const el = document.querySelector(sel);
      if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      seen.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    const clashes = [];
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const [a, b] = [seen[i], seen[j]];
        if (Math.min(a.r, b.r) - Math.max(a.l, b.l) <= 1 || Math.min(a.b, b.b) - Math.max(a.t, b.t) <= 1) continue;
        if ((a.name === 'tourCard' && under.includes(b.name)) || (b.name === 'tourCard' && under.includes(a.name))) continue;
        clashes.push(`${a.name}/${b.name}`);
      }
    }
    const shown = (sel) => Boolean(document.querySelector(sel)?.checkVisibility({ checkVisibilityCSS: true }));
    const map = document.getElementById('map').getBoundingClientRect();
    const pop = document.querySelector('.leaflet-popup');
    const close = document.querySelector('.leaflet-popup-close-button')?.getBoundingClientRect();
    const text = document.querySelector('.leaflet-popup-content');
    return {
      clashes,
      legend: shown('#map-symbols'),
      messages: [shown('#mode-note') && document.getElementById('mode-note').textContent !== '', shown('#walk-caption'), shown('#touch-hint')].filter(Boolean).length,
      popup: pop ? { share: pop.getBoundingClientRect().height / map.height, close: close ? Math.min(close.width, close.height) : 0, scrolls: text.scrollHeight >= text.clientHeight, source: !!text.querySelector('a[href^="https://"]') } : null,
    };
  }, [...UNDER_TOUR]);
  const openStop = (page) => page.evaluate((name) => { [...document.querySelectorAll('.leaflet-marker-icon')].find((m) => m.title === name)?.click(); }, LONGEST);
  const closePopup = (page) => page.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  const problems = [];
  const sizes = [[320, 568], [360, 800], [393, 851], [414, 896], [667, 375], [851, 393], [1280, 800]];
  for (const [width, height] of sizes) {
    const name = `${width}x${height}`;
    const compact = width <= 860;
    const { ctx, page } = await fresh();
    await page.setViewport(compact ? phoneView(width, height) : { width, height });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 });
    await pause(1000);
    await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start' }));
    await pause(300);
    const expect = async (state, { popup = false, covered = popup } = {}) => {
      await pause(600);
      const o = await overlaps(page);
      if (o.clashes.length) problems.push(`${name} ${state}: ${o.clashes.join(', ')}`);
      if (o.messages > 1) problems.push(`${name} ${state}: ${o.messages} messages at once`);
      if (covered && o.messages > 0) problems.push(`${name} ${state}: a message over the popup or panel`);
      if (covered && o.legend) problems.push(`${name} ${state}: the key stayed up`);
      if (popup && !o.popup) problems.push(`${name} ${state}: no popup`);
      if (popup && o.popup) {
        if (!o.popup.source) problems.push(`${name} ${state}: no source link`);
        if (compact && o.popup.share > 0.47) problems.push(`${name} ${state}: popup takes ${Math.round(o.popup.share * 100)}% of the map`);
        if (compact && o.popup.close < 44) problems.push(`${name} ${state}: close button ${o.popup.close}px`);
      }
      return o;
    };

    await openStop(page);
    await expect('stop popup, drawing', { popup: true });
    await closePopup(page);
    const restored = await expect('popup closed');
    if (!restored.legend) problems.push(`${name}: the key did not come back`);

    await page.click('#mode-inspect');
    await expect('check a point');
    await openStop(page);
    await expect('stop popup, check a point', { popup: true });
    await closePopup(page);
    await pause(150);
    const spot = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: Math.min(r.top + r.height * 0.55, innerHeight - 50) }; });
    if (compact) await page.touchscreen.tap(spot.x, spot.y); else await page.mouse.click(spot.x, spot.y);
    const reading = await expect('reading a point');
    if (!reading.popup) problems.push(`${name}: Check a point gave no reading`);
    await closePopup(page);
    await page.click('#mode-draw');
    await pause(150);

    await openStop(page);
    await pause(200);
    await page.click('#btn-map-layers');
    const layers = await expect('layers over a popup', { covered: true });
    if (layers.popup) problems.push(`${name}: Layers left the popup open`);
    await page.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].find((m) => m.title === 'Cheyava Falls (Bright Angel)')?.click());
    const popupOverLayers = await expect('popup over layers', { popup: true });
    if (popupOverLayers.clashes.some((c) => c.includes('layersPanel'))) problems.push(`${name}: panel stayed under the popup`);
    await closePopup(page);
    await pause(150);

    await openStop(page);
    await pause(200);
    await page.focus('#btn-tour');
    await page.keyboard.press('Enter');
    const tourStart = await expect('tour with a popup');
    if (tourStart.popup) problems.push(`${name}: the tour left the popup open`);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      await expect(`tour step ${i + 2}`);
    }
    await page.keyboard.press('Escape');
    await pause(150);
    await page.focus('#btn-tour');
    await page.keyboard.press('Enter');
    await pause(250);
    await openStop(page);
    const tourEnd = await expect('popup during the tour', { popup: true });
    if (await page.evaluate(() => !document.getElementById('tour').hidden)) problems.push(`${name}: the tour stayed open under a popup (${tourEnd.clashes})`);
    await closePopup(page);
    await pause(150);

    await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start' }));
    await openStop(page);
    await pause(150);
    await page.click('#walk-play');
    const walking = await expect('play with a popup');
    if (walking.popup) problems.push(`${name}: Play left the popup open`);
    await openStop(page);
    await expect('popup during play', { popup: true });
    await page.click('#walk-stop');
    await ctx.close();
  }
  check('No two map overlays overlap, at every size and state', problems.length === 0, problems.length ? problems.slice(0, 8).join(' | ') : '320, 360, 393, 414, 667x375, 851x393 and desktop: the longest stop text in both modes, a reading, Layers both ways, every tour step and during Play. Popup under 47% of a phone map, close button 44 px, one message at a time, key and readout hidden under a popup and back after');

  // The words match the device, and Check a point says one thing at a time.
  {
    const wording = async (viewport) => {
      const { ctx, page } = await fresh();
      await page.setViewport(viewport);
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ready(page);
      const note = () => page.$eval('#mode-note', (n) => n.textContent);
      const first = await note();
      await page.click('#mode-inspect');
      const step1 = await note();
      await pause(5300);
      const step2 = await note();
      const reasons = await page.$eval('#verdict-reasons', (r) => r.textContent);
      await ctx.close();
      return { first, step1, step2, reasons };
    };
    const touchScreen = await wording(phoneView(393, 851));
    const mouse = await wording({ width: 1280, height: 800 });
    const okTouch = touchScreen.first.startsWith('Tap the map') && touchScreen.step1.startsWith('Tap the map to read') && touchScreen.step2 === 'Nothing is added to your route. Tap Draw a route to go back.' && touchScreen.reasons.includes('or tap the map');
    const okMouse = mouse.first.startsWith('Click the map') && mouse.step1.startsWith('Click the map to read') && mouse.step2 === 'Nothing is added to your route. Press Esc to go back to drawing.' && mouse.reasons.includes('or click the map');
    check('Touch screens say Tap, keyboards say Esc, one message at a time', okTouch && okMouse, `touch: "${touchScreen.step1}" then "${touchScreen.step2}". Mouse: "${mouse.step1}" then "${mouse.step2}"`);
  }

  // A fresh load opens on Standard. A link that names a preset still wins.
  {
    const named = (page) => page.evaluate(() => document.getElementById('preset-note').hidden ? 'Standard' : document.getElementById('preset-note').textContent.split(' ')[0]);
    const address = (page) => page.evaluate(() => location.hash);
    const settled = async (page) => { await ready(page); await pause(700); };
    const { ctx, page } = await fresh();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settled(page);
    const fresh1 = await named(page);
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 });
    await pause(500);
    await page.evaluate(() => document.querySelector('[data-preset="ambitious"]').click());
    await pause(600);
    const chosen = await named(page);
    const addressAfter = await address(page);
    await page.evaluate(() => {
      window.copied = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.copied = t; } } });
    });
    await page.click('#btn-share');
    await pause(100);
    const link = await page.evaluate(() => window.copied);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settled(page);
    const reloaded = await named(page);
    const routeKept = await page.evaluate(() => document.querySelectorAll('.pin-waypoint').length);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /preset|setting/i.test(k)).length);
    await page.goto('about:blank');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settled(page);
    const bare = await named(page);
    await ctx.close();

    const second = await fresh();
    await second.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settled(second.page);
    const shared = await named(second.page);
    await second.page.reload({ waitUntil: 'domcontentloaded' });
    await settled(second.page);
    const sharedReload = await named(second.page);
    await second.ctx.close();
    const ok = fresh1 === 'Standard' && chosen === 'Ambitious' && !addressAfter.includes('p=') && link.includes('p=ambitious') && reloaded === 'Standard' && routeKept === 4 && stored === 0 && bare === 'Standard' && shared === 'Ambitious' && sharedReload === 'Ambitious';
    check('A fresh load opens on Standard, and a link naming a preset wins', ok, `fresh ${fresh1}; chose ${chosen}, address has a preset ${addressAfter.includes('p=')}, Copy link has it ${link.includes('p=ambitious')}; reload ${reloaded} with ${routeKept} pins; bare address ${bare}; stored presets ${stored}; shared link ${shared}, reloaded ${sharedReload}`);
  }
}

// Choosing a base map: the wait is on show, the old map stays, nothing else starts --------
if (!process.argv.includes('--basic')) {
  const problems = [];
  const details = [];
  for (const [id, product, width, height] of [['mola', 'Mars_MGS_MOLA_ClrShade', 393, 851], ['blend', 'Mars_MOLA_blend200ppx', 320, 568], ['mola', 'Mars_MGS_MOLA_ClrShade', 851, 393]]) {
    const name = `${id} ${width}x${height}`;
    const { ctx, page } = await fresh({ collect: false });
    await page.setViewport({ width, height, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    let release = null;
    const held = new Promise((r) => { release = r; });
    const started = [];
    page.on('request', async (req) => {
      const url = req.url();
      if (url.includes('trek.nasa.gov/tiles')) started.push(url);
      // Held from the start, so idle prefetch cannot fetch the tile before the choice is made.
      if (url.includes(product)) await held;
      req.continue().catch(() => {});
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ready(page);
    await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start' }));
    // The first map has to have drawn, or there is nothing yet to keep.
    await page.waitForFunction(() => document.querySelector('.leaflet-tile-pane img[src*="Jezero_CTX_BlockAdj_dd"].leaflet-tile-loaded'), { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    await page.click('#btn-map-layers');
    await new Promise((r) => setTimeout(r, 200));
    const countBefore = started.filter((u) => !u.includes(product)).length;
    await page.click(`#map-layers-panel input[value="${id}"]`);
    await new Promise((r) => setTimeout(r, 350));
    const state = () => page.evaluate((p) => {
      const busy = document.getElementById('map-busy');
      const visibleTile = [...document.querySelectorAll(`.leaflet-tile-pane img[src*="${p}"]`)].some((t) => t.classList.contains('leaflet-tile-loaded') && t.naturalWidth > 1);
      return {
        text: busy.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ? busy.textContent : '',
        panel: !document.getElementById('map-layers-panel').hidden,
        kept: [...document.querySelectorAll('.leaflet-tile-pane img[src*="Jezero_CTX_BlockAdj_dd"]')].some((t) => t.classList.contains('leaflet-tile-loaded')),
        arrived: visibleTile,
        note: document.getElementById('mode-note').checkVisibility(),
      };
    }, product);
    const early = await state();
    await new Promise((r) => setTimeout(r, 3100));
    const late = await state();
    const othersDuring = started.filter((u) => !u.includes(product)).length - countBefore;
    release();
    await page.waitForFunction((p) => [...document.querySelectorAll(`.leaflet-tile-pane img[src*="${p}"]`)].some((t) => t.classList.contains('leaflet-tile-loaded') && t.naturalWidth > 1), { timeout: 30000 }, product).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const done = await state();
    if (early.text !== 'Loading NASA tiles...' || early.panel || !early.kept || early.note) problems.push(`${name} at once: ${JSON.stringify(early)}`);
    if (!late.text.startsWith("Still waiting for NASA's tile server.") || !late.kept) problems.push(`${name} after 3 s: ${JSON.stringify(late)}`);
    if (othersDuring !== 0) problems.push(`${name}: ${othersDuring} other tile requests began during the wait`);
    if (!done.arrived || done.kept || done.text.startsWith('Still')) problems.push(`${name} at the end: ${JSON.stringify(done)}`);
    details.push(`${name}: "${early.text}", then "${late.text.slice(0, 30)}...", ${othersDuring} other requests`);
    await ctx.close();
  }
  check('Choosing a base map shows the wait, keeps the old map, and starts nothing else', problems.length === 0, problems.length ? problems.join(' | ') : details.join('; '));
}

// Presets: Standard unless asked, labeled, and the same route side by side ------
if (!process.argv.includes('--basic')) {
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 });
  const standard = await read(page);
  await page.waitForSelector('[data-preset="ambitious"]', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[data-preset="ambitious"]').click());
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'go', { timeout: 15000 }).catch(() => {});
  const after = await read(page);
  const shown = await page.evaluate(() => ({
    note: document.getElementById('preset-note').textContent,
    compare: document.getElementById('preset-compare').textContent.replace(/\s+/g, ' '),
  }));
  const stated = shown.note.includes('not NASA values') && shown.compare.includes('Before: Standard') && shown.compare.includes('Now: Ambitious');
  check('Presets show the same route side by side', standard.slope === '18.1° at 4.44 km' && standard.word === 'CAUTION' && after.word === 'GO' && after.slope === '18.1° at 4.44 km' && stated, `${standard.word} to ${after.word}, slope ${after.slope}. ${shown.note}`);
  await ctx.close();
}

// Safest route: the NO-GO link has a way round, found on the live page -----------
if (!process.argv.includes('--basic')) {
  const { ctx, page } = await fresh();
  await page.goto(NOGO, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'nogo', { timeout: 15000 });
  await page.click('#more-tools > summary');
  await page.click('#btn-safest');
  await page.waitForFunction(() => !document.getElementById('btn-restore').hidden, { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const s = await read(page);
  const slope = parseFloat(s.slope);
  await page.click('#btn-restore');
  await page.waitForFunction(() => document.querySelectorAll('.pin-waypoint').length === 5, { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const back = await read(page);
  check('Safest route stays within the limit', slope <= 25 && s.word !== 'NO-GO' && back.slope === '26.7° at 5.13 km', `${s.word}, ${s.slope}, ${s.distance}, ${s.pins} waypoints. Restored: ${back.word} ${back.slope}`);
  await ctx.close();
}

// 5. Route leaving the data area ---------------------------------------------
{
  const { ctx, page } = await fresh();
  await page.goto(OFFMAP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state !== 'empty', { timeout: 15000 });
  const s = await read(page);
  const missing = s.reasons.find((r) => r.includes('no elevation data'));
  check('Leaving data area gives NO-GO', s.word === 'NO-GO' && !!missing, `${s.word}: ${missing ?? 'no missing-data reason'}`);
  await ctx.close();
}

// 6. Console -----------------------------------------------------------------
check('No console errors', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 4).join(' | ') : 'none across all page loads');

// 7. Outages ------------------------------------------------------------------
// The app needs no third-party host but NASA Trek.
{
  const { ctx, page } = await fresh({ block: ['*cdnjs.cloudflare.com*'] });
  const hosts = new Set();
  page.on('request', (r) => { if (r.url().startsWith('http')) hosts.add(new URL(r.url()).hostname); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 }).catch(() => {});
  const s = await read(page);
  const leaflet = await page.evaluate(() => ({ version: window.L?.version, file: performance.getEntriesByType('resource').find((r) => r.name.includes('leaflet.min.js'))?.name ?? '' }));
  // Local security software can inject its own script into any page, so it does not count.
  const others = [...hosts].filter((h) => h !== new URL(BASE).hostname && h !== 'trek.nasa.gov' && !h.includes('kaspersky'));
  check('Works with cdnjs blocked, using our own Leaflet', s.word === 'CAUTION' && s.slope === '18.1° at 4.44 km' && leaflet.version === '1.9.4' && leaflet.file.startsWith(BASE) && others.length === 0, `${s.word} ${s.slope}, Leaflet ${leaflet.version} from ${leaflet.file.replace(BASE, '')}, other hosts: ${others.join(', ') || 'none'}`);
  await ctx.close();
}

{
  const { ctx, page } = await fresh({ block: ['*leaflet.min.js*'], collect: false });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('verdict-word')?.textContent !== 'Loading the map', { timeout: 30000 }).catch(() => {});
  const s = await read(page);
  check('Map library failure says so', s.word === "The map couldn't load. Reload the page." && s.reasons.length === 0 && s.demoDisabled && s.loadError, `"${s.word}", reasons ${s.reasons.length}, demo disabled ${s.demoDisabled}, box on the map ${s.loadError}`);
  await ctx.close();
}

{
  const { ctx, page } = await fresh({ block: ['*trek.nasa.gov*'], collect: false });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.getElementById('verdict')?.dataset.state === 'caution', { timeout: 15000 }).catch(() => {});
  await ready(page);
  await page.waitForFunction(() => !document.getElementById('map-notice').hidden, { timeout: 20000 }).catch(() => {});
  const s = await read(page);
  const tiles = await page.evaluate(() => ({ real: [...document.querySelectorAll('.leaflet-tile')].filter((t) => t.src.includes('trek.nasa.gov') && t.naturalWidth > 1).length, blank: [...document.querySelectorAll('.leaflet-tile')].filter((t) => t.src.startsWith('data:')).length }));
  check('Works with trek.nasa.gov blocked, using the outage fallback', s.notice && s.underlay && s.word === 'CAUTION' && s.slope === '18.1° at 4.44 km' && tiles.real === 0, `notice ${s.notice}, local image ${s.underlay}, real tiles ${tiles.real}, ${s.word} ${s.slope}`);
  await ctx.close();
}

// 8 and 9. Progressive terrain, on builds that have it --------------------------
if (!process.argv.includes('--basic')) {
  const verdictText = (page) => page.evaluate(() => document.getElementById('verdict').innerText);
  const NAMES_A_LEVEL = /\bGO\b|CAUTION|NO-GO/;

  // Hold the report grid back, and see exactly what a user would see meanwhile.
  {
    const { ctx, page } = await fresh({ collect: false });
    await page.setRequestInterception(true);
    let release;
    const held = new Promise((r) => { release = r; });
    page.on('request', async (req) => {
      if (/terrain_full/.test(req.url())) await held;
      req.continue().catch(() => {});
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('btn-demo').disabled, { timeout: 60000 });
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'refining', { timeout: 15000 });
    const preview = await read(page);
    const text = await verdictText(page);
    const previewOk = preview.word === 'Refining...' && preview.slope === 'refining...' && preview.distance === '4.83 km' && !NAMES_A_LEVEL.test(text) && preview.refining && preview.sentence === '' && !preview.walkShown && !preview.turnShown && preview.scienceOff && preview.science === 'Refining... | Refining...' && !preview.alongShown;
    const slopeHeld = await page.evaluate(() => {
      document.querySelector('input[name="overlay-slope"]').click();
      return { status: document.querySelector('[data-status="slope"]').textContent, image: !!document.querySelector('img.slope-image') };
    });
    release();
    await ready(page);
    await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'caution', { timeout: 15000 }).catch(() => {});
    const final = await read(page);
    check('Preview is labeled, never a verdict', previewOk, `while held: "${preview.word}", slope "${preview.slope}", distance ${preview.distance}, level named: ${NAMES_A_LEVEL.test(text)}, sentence "${preview.sentence}"`);
    check('Switches to the report grid exactly', final.word === 'CAUTION' && final.slope === '18.1° at 4.44 km' && !final.refining && final.sentence.includes('18.1° at 4.44 km') && final.walkShown && final.turnShown && !final.scienceOff && final.alongShown, `after release: ${final.word}, ${final.slope}, sentence shown ${final.sentence !== ''}`);
    const slopeAfter = await page.waitForSelector('img.slope-image', { timeout: 30000 }).then(() => true, () => false);
    check('Slope map waits for the report grid', slopeHeld.status.startsWith('Refining...') && !slopeHeld.image && slopeAfter, `while held: "${slopeHeld.status}", image ${slopeHeld.image}. After release: image ${slopeAfter}`);
    await ctx.close();
  }

  // Refuse the report grid, and make sure the preview is not used as a fallback.
  {
    const { ctx, page } = await fresh({ collect: false });
    await page.setRequestInterception(true);
    page.on('request', (req) => (/terrain_full/.test(req.url()) ? req.abort() : req.continue()).catch(() => {}));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('btn-demo').disabled, { timeout: 60000 });
    await page.click('#btn-demo');
    await page.waitForFunction(() => document.getElementById('verdict').dataset.state === 'unavailable', { timeout: 20000 }).catch(() => {});
    const s = await read(page);
    const text = await verdictText(page);
    check('No fallback if the report grid fails', s.word === 'No verdict' && s.loadError && !NAMES_A_LEVEL.test(text) && s.sentence === '' && !s.walkShown && !s.turnShown && s.scienceOff && s.science === 'No report grid | No report grid' && !s.alongShown, `shows "${s.word}", error box ${s.loadError}, level named: ${NAMES_A_LEVEL.test(text)}, sentence "${s.sentence}"`);
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : `\nALL ${results.length} CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
