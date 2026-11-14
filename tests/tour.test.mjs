// The tour's words and where its card lands. tools/verify_site.mjs walks it in a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOUR_STEPS, placeCard } from '../js/tour.js';

const page = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const card = { width: 320, height: 170 };
const desktop = { width: 1280, height: 800 };
const phone = { width: 375, height: 812 };
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('six steps, in the order asked for', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.title), ['Try the demo walk', 'The verdict', 'Why?', 'Check a point', 'Example missions', 'More tools']);
});

test('every target is on the page, and every caption is short', () => {
  for (const name of ['btn-demo', 'verdict', 'mode-inspect', 'scenarios-section', 'more-tools']) assert.ok(page.includes(`id="${name}"`), name);
  assert.ok(page.includes('class="btn-why"'));
  for (const s of TOUR_STEPS) {
    for (const hasRoute of [false, true]) assert.ok(s.text(hasRoute).length <= 130, `${s.title}: ${s.text(hasRoute).length}`);
  }
});

test('step 1 says what Next will do, depending on the route', () => {
  assert.ok(TOUR_STEPS[0].text(false).includes('Press Next and the tour will load it'));
  assert.ok(TOUR_STEPS[0].text(true).includes('will use yours'));
});

test('the verdict caption never presents a result', () => {
  const text = TOUR_STEPS[1].text(true);
  assert.ok(text.includes('GO, CAUTION or NO-GO') && text.includes('Refining...'));
});

test('on a wide screen the card sits beside the target', () => {
  const at = placeCard(box(16, 200, 378, 48), card, desktop);
  assert.deepEqual(at, { left: 406, top: 200 });
});

test('on a phone the card goes below the target, then above it', () => {
  assert.deepEqual(placeCard(box(16, 300, 343, 52), card, phone), { left: 16, top: 364 });
  assert.deepEqual(placeCard(box(16, 700, 343, 52), card, phone), { left: 16, top: 518 });
});

test('on a phone on its side the card fits under the verdict', () => {
  const side = { width: 667, height: 375 };
  const tall = { width: 320, height: 187 };
  const at = placeCard(box(16, 8, 635, 96), tall, side);
  assert.deepEqual(at, { left: 16, top: 116 });
  assert.ok(at.top + tall.height <= side.height - 12);
});

test('at Why? the card stays clear of the whole verdict', () => {
  assert.equal(TOUR_STEPS[2].around, '#verdict');
  assert.ok(TOUR_STEPS.every((s) => !s.around || page.includes(`id="${s.around.slice(1)}"`)));
});

test('the card stays on screen when the target is scrolled away', () => {
  assert.equal(placeCard(box(16, -300, 343, 52), card, phone).top, 12);
  assert.equal(placeCard(box(16, 1200, 343, 52), card, phone).top, phone.height - card.height - 12);
});

test('the card stays on screen even when nothing fits', () => {
  const short = { width: 375, height: 200 };
  const { left, top } = placeCard(box(16, 40, 343, 120), card, short);
  assert.ok(left >= 12 && left + card.width <= short.width);
  assert.ok(top >= 12 && top + card.height <= short.height);
});
