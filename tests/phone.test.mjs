// The phone usability pass: what the page must keep, read from the source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOUR_STEPS } from '../js/tour.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('index.src.html');
const css = read('css/style.css');
const main = read('js/main.js');

test('both science views have a visible way out, and a route from the table can be undone', () => {
  assert.ok(page.includes('id="btn-reach-clear" hidden>Clear results</button>'));
  assert.ok(page.includes('id="btn-rover-clear">Clear rover colours</button>'));
  assert.ok(page.includes('id="btn-reach-undo">Restore my route</button>'));
});

test('More tools says what is inside', () => {
  assert.ok(page.includes('<summary><span>More tools: layers, slope map, safest route, stops<small>'));
});

test('the More tools hint is not part of the first view', () => {
  assert.ok(page.includes('class="tools-hint" id="tools-hint" hidden'));
  assert.ok(main.includes("showToolsHint(status === 'final')"), 'only once there is a verdict');
});

test('a dragged marker keeps the touch when one finger scrolls the page', () => {
  assert.ok(css.includes('.leaflet-marker-draggable { touch-action: none; }'));
});

test('two-finger map panning is only for touch screens with a tall map', () => {
  assert.ok(main.includes("window.matchMedia('(pointer: coarse)').matches && map.getSize().y > window.innerHeight * TALL_MAP"));
  assert.ok(main.includes('const TALL_MAP = 0.6;'));
});

test('the key, the readout and a notice share one stack, so they cannot overlap', () => {
  const stack = page.slice(page.indexOf('<div class="map-bottom">'));
  for (const id of ['id="map-symbols"', 'id="readout"', 'id="map-notice"']) assert.ok(stack.includes(id), id);
  assert.ok(!page.includes('id="inspect-hint"'), 'the second message is gone');
});

test('a popup or panel hides the messages and the key, and they return with it', () => {
  assert.ok(css.includes('.mapwrap.map-covered :is(.mode-note, .map-busy, .touch-hint, .walk-caption, .keyboard-hint, .map-bottom)'));
  assert.ok(main.includes("classList.toggle('map-covered', covered)"));
});

test('touch screens get a compact popup with a 44 px close button', () => {
  assert.ok(css.includes('@media (max-width: 860px), (pointer: coarse) {'));
  assert.ok(css.includes('width: 44px; height: 44px;'));
  assert.ok(main.includes('Math.round(y * 0.45)'));
});

test('touch and keyboard wording', () => {
  assert.ok(main.includes("usesTouch() ? 'Tap Draw a route to go back.' : 'Press Esc to go back to drawing.'"));
  assert.ok(main.includes("usesTouch() ? 'Tap' : 'Click'"));
});

test('the address bar keeps a preset only if it came in on a link, and Copy link always has it', () => {
  assert.ok(main.includes('presetOf(state.settings)?.id === linkPreset ? linkPreset : null'));
  assert.ok(main.includes('#${shareHash()}'));
  assert.ok(!/localStorage[^\n]*preset/i.test(main), 'no preset is ever stored');
});

test('waiting for a base map is always shown, and says so if it runs long', () => {
  assert.ok(main.includes('const BASE_SLOW_MS = 3000;'));
  assert.ok(main.includes("Still waiting for NASA's tile server."));
  assert.ok(css.includes('.mapwrap:has(.map-busy[data-base-loading="true"]) .mode-note { display: none; }'));
});

test('prefetch re-checks for a loading layer when its turn comes', () => {
  assert.ok(main.includes('if (busyLayers.size) return; // A layer started loading'));
});

test('the base maps ask for no zoom past what NASA publishes', async () => {
  const { BASE_LAYERS } = await import('../js/layers.js');
  const native = Object.fromEntries(BASE_LAYERS.map((l) => [l.id, l.maxNativeZoom]));
  assert.deepEqual(native, { ctx: 12, blend: 8, mola: 7 });
});

test('the tour ends on More tools, and stays within seven steps', () => {
  assert.equal(TOUR_STEPS.at(-1).target, '#more-tools > summary');
  assert.ok(TOUR_STEPS.length <= 7);
  assert.ok(TOUR_STEPS[4].text(true).includes('Reachable science') && TOUR_STEPS[4].text(true).includes('rover path'));
});
