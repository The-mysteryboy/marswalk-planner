// Presets must change only what they say they change, and Standard must change nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeState, encodeState } from '../js/hash.js';
import { NOT_NASA, PRESETS, compareHtml, compareVerdicts, presetName, presetNote, presetOf, presetSettings } from '../js/presets.js';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute } from '../js/report.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
const KNOWN = { baseIds: ['ctx'], overlayIds: ['rover', 'stops'], presetIds: PRESETS.map((p) => p.id) };

function result(points, settings) {
  const m = measureRoute(points, points[0], terrain, settings);
  return { m, level: decideVerdict(m, settings).level };
}

test('there are exactly three presets', () => {
  assert.deepEqual(PRESETS.map((p) => p.label), ['Cautious', 'Standard', 'Ambitious']);
});

test('Standard is the defaults, exactly', () => {
  assert.deepEqual(presetSettings('standard'), { ...DEFAULT_SETTINGS });
  assert.equal(presetOf(DEFAULT_SETTINGS).id, 'standard');
});

test('Standard reproduces the validated numbers exactly', () => {
  const demo = result(DEMO, presetSettings('standard'));
  assert.equal(demo.level, 'caution');
  assert.equal(demo.m.maxSlopeDeg.toFixed(1), '18.1');
  assert.equal((demo.m.maxSlopeAtM / 1000).toFixed(2), '4.44');
  const scarp = result(SCARP, presetSettings('standard'));
  assert.equal(scarp.level, 'nogo');
  assert.equal(scarp.m.maxSlopeDeg.toFixed(1), '26.7');
  assert.equal((scarp.m.maxSlopeAtM / 1000).toFixed(2), '5.13');
});

test('presets change only walking speed, EVA length and the slope limits', () => {
  const allowed = new Set(['baseSpeedKmh', 'evaHours', 'cautionSlopeDeg', 'maxSlopeDeg']);
  for (const preset of PRESETS) {
    const full = presetSettings(preset.id);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!allowed.has(key)) assert.equal(full[key], DEFAULT_SETTINGS[key], `${preset.id} changed ${key}`);
    }
    assert.deepEqual(Object.keys(full).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  }
  for (const id of ['cautious', 'ambitious']) {
    assert.deepEqual(Object.keys(PRESETS.find((p) => p.id === id).values).sort(), [...allowed].sort());
  }
});

test('Cautious is stricter than Standard, Ambitious looser, on every field', () => {
  const [c, s, a] = ['cautious', 'standard', 'ambitious'].map(presetSettings);
  for (const key of ['baseSpeedKmh', 'evaHours', 'cautionSlopeDeg', 'maxSlopeDeg']) {
    assert.ok(c[key] < s[key] && s[key] < a[key], key);
  }
});

test('slope measurements do not depend on the preset', () => {
  const all = PRESETS.map((p) => result(SCARP, presetSettings(p.id)).m.maxSlopeDeg);
  assert.equal(new Set(all).size, 1);
});

test('the same routes get the verdicts their numbers call for', () => {
  assert.equal(result(DEMO, presetSettings('ambitious')).level, 'go', '18.1° is under the 20° caution limit');
  assert.equal(result(SCARP, presetSettings('ambitious')).level, 'caution', '26.7° is under 30° and over 20°');
  assert.equal(result(SCARP, presetSettings('cautious')).level, 'nogo');
  assert.equal(result(DEMO, presetSettings('cautious')).level, 'caution', '18.1° is under the 20° limit');
});

test('an edited value is no longer a preset', () => {
  assert.equal(presetOf({ ...DEFAULT_SETTINGS, evaHours: 7 }), null);
  assert.equal(presetName({ ...DEFAULT_SETTINGS, evaHours: 7 }), 'Custom');
  assert.equal(presetName(presetSettings('ambitious')), 'Ambitious');
});

test('comparison holds both verdicts for the same route', () => {
  const measure = (s) => measureRoute(SCARP, SCARP[0], terrain, s);
  const { before, after } = compareVerdicts(measure, presetSettings('standard'), presetSettings('ambitious'));
  assert.equal(before.name, 'Standard');
  assert.equal(before.level, 'nogo');
  assert.equal(after.name, 'Ambitious');
  assert.equal(after.level, 'caution');
  assert.equal(before.m.distanceM, after.m.distanceM);
});

test('every preset other than Standard says it is not a NASA value', () => {
  assert.match(NOT_NASA, /not NASA values/);
  assert.equal(presetNote(presetSettings('standard')), '');
  assert.equal(presetNote(presetSettings('cautious')), `Cautious preset. ${NOT_NASA}`);
  assert.equal(presetNote(presetSettings('ambitious')), `Ambitious preset. ${NOT_NASA}`);
  assert.equal(presetNote({ ...DEFAULT_SETTINGS, evaHours: 7 }), `Custom assumptions. ${NOT_NASA}`);
});

test('the comparison shows both verdicts, or Refining with no level at all', () => {
  const measure = (s) => measureRoute(SCARP, SCARP[0], terrain, s);
  const html = compareHtml(compareVerdicts(measure, presetSettings('standard'), presetSettings('ambitious')), 'Refining...');
  assert.match(html, /Before: Standard[\s\S]*NO-GO[\s\S]*Now: Ambitious[\s\S]*CAUTION/);
  assert.match(html, /25° \/ 30°|15° \/ 25°/);
  const waiting = compareHtml(null, 'Refining...');
  assert.ok(waiting.includes('Refining...'));
  assert.ok(!/\bGO\b|CAUTION|NO-GO/.test(waiting));
});

test('hash: Standard is never written, so links look exactly as they did', () => {
  const plan = { habitat: HOME, waypoints: [DEMO[1]], baseId: 'ctx', overlays: new Set(['rover']) };
  assert.ok(!encodeState({ ...plan, preset: null }).includes('p='));
  assert.ok(!encodeState({ ...plan, preset: 'standard' }).includes('p='));
  assert.ok(!encodeState(plan).includes('p='));
});

test('hash: a preset round-trips, and old or unknown links mean Standard', () => {
  const plan = { habitat: HOME, waypoints: [DEMO[1]], baseId: 'ctx', overlays: new Set(['rover']) };
  assert.equal(decodeState(`#${encodeState({ ...plan, preset: 'ambitious' })}`, KNOWN).preset, 'ambitious');
  assert.equal(decodeState(`#${encodeState(plan)}`, KNOWN).preset, null);
  assert.equal(decodeState(`#${encodeState(plan)}&p=reckless`, KNOWN).preset, null);
  assert.equal(decodeState(`#${encodeState(plan)}&p=ambitious`, { baseIds: ['ctx'], overlayIds: ['rover'] }).preset, null);
});
