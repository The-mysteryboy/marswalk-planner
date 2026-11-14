// Science along this walk and the latest conditions reading.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FEED_LABEL, LATEST_FEED, latestLine, latestReading } from '../js/conditions.js';
import { DEFAULT_SETTINGS, alongRoute, decideVerdict, measureRoute, steepSections, stopsNearRoute } from '../js/report.js';
import { haversineM } from '../js/route.js';
import { TOUR_STEPS } from '../js/tour.js';
import { buildWalk, passCaption, stopPasses } from '../js/walk.js';
import { dataPath, loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const stops = JSON.parse(readFileSync(dataPath('science_stops.json'), 'utf8')).stops;
const feed = JSON.parse(readFileSync(new URL('./fixtures/msl_weather_sample.json', import.meta.url), 'utf8'));
const S = { ...DEFAULT_SETTINGS };
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
const LONG = [...DEMO, ...DEMO.slice(1, -1).reverse(), HOME, ...DEMO.slice(1)];

const report = (points, settings = S) => {
  const m = measureRoute(points, HOME, terrain, settings);
  const near = stopsNearRoute(stops, m.samples, settings.stopRadiusKm);
  return { m, near, verdict: decideVerdict(m, settings), sections: steepSections(m.samples, settings), settings, status: 'final' };
};

test('the demo route has 7 stops within 2 km, the same list the report already finds', () => {
  const r = report(DEMO);
  assert.equal(r.near.length, 7);
  assert.deepEqual(r.near.map((s) => s.id).sort(), ['brac', 'oeb', 'rochette', 'skinner', 'threeforks', 'wbf', 'wildcat']);
});

test('the NO-GO link has the same 7 stops', () => {
  assert.equal(report(SCARP).near.length, 7);
});

test('the card lists them in the order the route passes them', () => {
  const ordered = alongRoute(report(DEMO).near);
  assert.deepEqual(ordered.map((s) => s.id), ['oeb', 'wbf', 'brac', 'rochette', 'threeforks', 'wildcat', 'skinner']);
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i].alongM >= ordered[i - 1].alongM);
});

test('captions name every near stop once, in the order the walk first comes within range', () => {
  const r = report(DEMO);
  const walk = buildWalk(r);
  assert.deepEqual(walk.passes.map((p) => p.id).sort(), r.near.map((s) => s.id).sort());
  assert.deepEqual(walk.passes.map((p) => p.id), ['oeb', 'wbf', 'brac', 'rochette', 'threeforks', 'wildcat', 'skinner']);
  for (let i = 1; i < walk.passes.length; i++) assert.ok(walk.passes[i].d >= walk.passes[i - 1].d);
});

test('a caption appears at the first sample within the stop search distance, not before', () => {
  const r = report(DEMO);
  const { samples } = r.m;
  for (const pass of buildWalk(r).passes) {
    const stop = stops.find((s) => s.id === pass.id);
    const i = samples.findIndex((s) => s.d === pass.d);
    assert.ok(haversineM(samples[i], stop) <= 2000, pass.id);
    if (i > 0) assert.ok(haversineM(samples[i - 1], stop) > 2000, `${pass.id} was in range earlier`);
    assert.equal(pass.h, samples[i].outH);
  }
});

test('the caption text is the stop name and its sourced reason', () => {
  const brac = stops.find((s) => s.id === 'brac');
  assert.equal(passCaption([{ name: brac.name, why: brac.why }]), `Passing ${brac.name}: ${brac.why}`);
});

test('a walk that turns back only passes the stops it reaches', () => {
  const r = report(LONG);
  const walk = buildWalk(r);
  assert.equal(walk.turnBack.kind, 'turn');
  assert.ok(walk.passes.every((p) => p.d <= walk.farM));
  assert.deepEqual(walk.passes, stopPasses(r.m.samples, r.near, 2000, walk.cut));
});

test('captions change no total, speed or time', () => {
  const r = report(DEMO);
  const withStops = buildWalk(r);
  const without = buildWalk({ ...r, near: [] });
  assert.equal(withStops.totalH, without.totalH);
  assert.equal(withStops.totalH, r.m.evaUsedH);
  assert.equal(without.passes.length, 0);
});

test('the tour verdict step mentions the science stops', () => {
  const text = TOUR_STEPS[1].text(true);
  assert.ok(text.includes('science stops') && text.includes('GO, CAUTION or NO-GO') && text.includes('Refining...'));
  assert.ok(text.length <= 130);
});

// --- Conditions -------------------------------------------------------------------
const today = new Date('2026-11-14T12:00:00Z');

test('the newest feed reading, with its age in days', () => {
  assert.deepEqual(latestReading(feed, today), { sol: 4995, date: '2026-08-25', ageDays: 81, minC: -71, maxC: -5, pressurePa: 777 });
  assert.equal(latestLine(latestReading(feed, today)), "Latest reported: sol 4995 (2026-08-25), 81 days ago, from Curiosity's REMS weather feed. Air -71 °C to -5 °C, pressure 777 Pa.");
});

test('a placeholder or an impossible value shows nothing', () => {
  const newest = feed.soles[0];
  const variant = (change) => ({ soles: [{ ...newest, ...change }] });
  for (const change of [{ min_temp: '--' }, { max_temp: '' }, { pressure: '--' }, { min_temp: '-200' }, { max_temp: '60' }, { min_temp: '0', max_temp: '-10' }, { pressure: '50' }, { pressure: '2000' }, { terrestrial_date: '2027-01-01' }, { terrestrial_date: 'soon' }, { sol: '-3' }]) {
    assert.equal(latestReading(variant(change), today), null, JSON.stringify(change));
  }
  assert.equal(latestReading({}, today), null);
  assert.equal(latestReading({ soles: [] }, today), null);
  assert.equal(latestReading(null, today), null);
});

test('the feed is labelled as the brief asks, and is Curiosity at Gale', () => {
  assert.equal(FEED_LABEL, "Outreach-grade feed, not science-grade, not live. Curiosity's weather is from Gale Crater, not Jezero.");
  assert.ok(LATEST_FEED.url.includes('category=msl'));
  assert.ok(!LATEST_FEED.url.includes('insight'));
});

test('the age reads naturally', () => {
  const at = (date) => latestLine(latestReading({ soles: [{ ...feed.soles[0], terrestrial_date: date }] }, today));
  assert.ok(at('2026-11-14').includes(', today, '));
  const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  assert.ok(at(yesterday).includes(', 1 day ago, '));
});

// --- Words --------------------------------------------------------------------------
test('the About box answers the challenge in plain words, and the README makes no claims', () => {
  const page = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(page.includes('<h3>How this answers the challenge</h3>'));
  for (const words of ['A layered, integrated view', 'Multiple NASA missions', 'A route and destinations', 'Conditions:', 'Data to complete a walk safely', 'Science along the way']) assert.ok(page.includes(words), words);
  assert.ok(page.includes("every slope limit, speed and time budget is this project's assumption, not NASA's"));
  assert.ok(readme.includes('**Next steps:**') && readme.includes('not endorsed by NASA'));
  assert.ok(!/tested (by|with) astronauts|used by \d|endorsed by NASA[^,]/i.test(readme.replace('not endorsed by NASA', '')));
});
