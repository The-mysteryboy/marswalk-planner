// The sentence above the numbers says what the report says, in words, and nothing else.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS, decideVerdict, formatDuration, measureRoute, routeSentence, verdictForDisplay,
} from '../js/report.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const settings = { ...DEFAULT_SETTINGS };
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];

const report = (points, s = settings) => {
  const m = measureRoute(points, HOME, terrain, s);
  const verdict = decideVerdict(m, s);
  return { m, verdict, sentence: routeSentence(m, verdict, s, 'final') };
};

// Each piece exactly as the stats panel prints it, so the two can never read differently.
function assertMatchesStats(sentence, m, s) {
  assert.ok(sentence.includes(`${(m.distanceM / 1000).toFixed(2)} km each way`), 'distance');
  assert.ok(sentence.includes(`${m.maxSlopeDeg.toFixed(1)}° at ${(m.maxSlopeAtM / 1000).toFixed(2)} km`), 'slope and where');
  assert.ok(sentence.includes(`takes ${formatDuration(m.evaUsedH)} outside`), 'total time outside');
  assert.ok(sentence.includes(`${m.marginPct.toFixed(0)}% of the time to spare`), 'time to spare');
  assert.equal(s.evaHours, 8);
}

test('demo route: the sentence matches the validated report', () => {
  const { m, verdict, sentence } = report(DEMO);
  assert.equal(verdict.level, 'caution');
  assert.equal(m.maxSlopeDeg.toFixed(1), '18.1');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '4.44');
  assert.ok(sentence.startsWith('This walk of 4.83 km each way gets a CAUTION: its steepest slope is 18.1° at 4.44 km, over our assumed caution limit of 15°, and it takes '), sentence);
  assertMatchesStats(sentence, m, settings);
});

test('NO-GO link: the sentence matches the validated report', () => {
  const { m, verdict, sentence } = report(SCARP);
  assert.equal(verdict.level, 'nogo');
  assert.equal(m.maxSlopeDeg.toFixed(1), '26.7');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '5.13');
  assert.ok(sentence.includes('gets a NO-GO: its steepest slope is 26.7° at 5.13 km, over our assumed limit of 25°, and it takes '), sentence);
  assertMatchesStats(sentence, m, settings);
});

test('nothing is said until the report grid has loaded', () => {
  const { m, verdict } = report(DEMO);
  for (const status of ['loading', 'preview', 'failed', undefined]) {
    assert.equal(routeSentence(m, verdict, settings, status), '', String(status));
    assert.notEqual(verdictForDisplay(verdict, status ?? 'loading', 80).state, 'caution');
  }
});

test('a GO says it is within the limit, and follows edited limits', () => {
  const edited = { ...settings, cautionSlopeDeg: 20, maxSlopeDeg: 30 };
  const { m, verdict, sentence } = report(DEMO, edited);
  assert.equal(verdict.level, 'go');
  assert.ok(sentence.includes('gets a GO: its steepest slope is 18.1° at 4.44 km, within our assumed caution limit of 20°, and it takes '), sentence);
  assertMatchesStats(sentence, m, edited);
});

const sample = {
  distanceM: 12340, maxSlopeDeg: 10, maxSlopeAtM: 2000, leavesCoverage: false, uncoveredM: 0, evaUsedH: 6.5, marginPct: 18.75,
};

test('a short reserve is named, with its limit', () => {
  const sentence = routeSentence(sample, decideVerdict(sample, settings), settings, 'final');
  assert.equal(sentence, 'This walk of 12.34 km each way gets a CAUTION: its steepest slope is 10.0° at 2.00 km, within our assumed caution limit of 15°, and it takes 6 h 30 min outside with only 19% of the time to spare, under our assumed reserve of 25%.');
});

test('over the time limit, it never reports time to spare', () => {
  const m = { ...sample, evaUsedH: 9, marginPct: -12.5 };
  const sentence = routeSentence(m, decideVerdict(m, settings), settings, 'final');
  assert.equal(sentence, 'This walk of 12.34 km each way gets a NO-GO: its steepest slope is 10.0° at 2.00 km, within our assumed caution limit of 15°, and it takes 9 h 00 min outside, over our assumed time limit of 8 h.');
});

test('a flat route has no position to name', () => {
  const m = { ...sample, maxSlopeDeg: 0, maxSlopeAtM: 0, evaUsedH: 2, marginPct: 75 };
  const sentence = routeSentence(m, decideVerdict(m, settings), settings, 'final');
  assert.ok(sentence.includes('its steepest slope is 0.0°, within'), sentence);
});

test('a route off the data says only that, because its slope and time are incomplete', () => {
  const points = [HOME, { lat: 18.45865, lon: 77.40592 }, { lat: 19.05, lon: 77.4 }];
  const { m, verdict, sentence } = report(points);
  assert.equal(verdict.level, 'nogo');
  assert.equal(sentence, `This walk of ${(m.distanceM / 1000).toFixed(2)} km each way gets a NO-GO: ${(m.uncoveredM / 1000).toFixed(2)} km of it has no elevation data, so its safety is unknown.`);
});
