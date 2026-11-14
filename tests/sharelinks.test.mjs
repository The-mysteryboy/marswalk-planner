// Links already shared must keep working: same route, same layers, same numbers.
// These are literal copies of links from before the layout changed. Do not regenerate them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeState, encodeState } from '../js/hash.js';
import { BASE_LAYERS, COMPUTED_OVERLAYS, TILE_OVERLAYS, VECTOR_OVERLAYS } from '../js/layers.js';
import { PRESETS, presetSettings } from '../js/presets.js';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute } from '../js/report.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const DEMO_LINK = '#h=18.44463,77.45089&w=18.43396,77.44302;18.45263,77.40776;18.45865,77.40592;18.4669,77.4298&b=ctx&o=rover,stops';
const NOGO_LINK = '#h=18.44463,77.45089&w=18.43396,77.44302;18.45263,77.40776;18.45865,77.40592;18.4669,77.4298;18.4731,77.4214&b=ctx&o=rover,stops';
const OFF_MAP_LINK = '#h=18.44463,77.45089&w=18.45865,77.40592;19.05,77.4&b=ctx&o=rover,stops';

const known = {
  baseIds: BASE_LAYERS.map((c) => c.id),
  overlayIds: [...TILE_OVERLAYS, ...VECTOR_OVERLAYS, ...COMPUTED_OVERLAYS].map((c) => c.id),
  presetIds: PRESETS.map((p) => p.id),
};

function open(link) {
  const plan = decodeState(link, known);
  const settings = presetSettings(plan.preset ?? 'standard');
  const m = measureRoute([plan.habitat, ...plan.waypoints], plan.habitat, terrain, settings);
  return { plan, m, level: decideVerdict(m, settings).level };
}

test('the demo link gives the validated numbers on the Standard preset', () => {
  const { plan, m, level } = open(DEMO_LINK);
  assert.equal(plan.preset, null);
  assert.equal(plan.waypoints.length, 4);
  assert.equal(plan.baseId, 'ctx');
  assert.deepEqual([...plan.overlays], ['rover', 'stops']);
  assert.equal(level, 'caution');
  assert.equal(m.maxSlopeDeg.toFixed(1), '18.1');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '4.44');
  assert.equal((m.distanceM / 1000).toFixed(2), '4.83');
});

test('the NO-GO link gives the validated numbers on the Standard preset', () => {
  const { plan, m, level } = open(NOGO_LINK);
  assert.equal(plan.preset, null);
  assert.equal(plan.waypoints.length, 5);
  assert.equal(level, 'nogo');
  assert.equal(m.maxSlopeDeg.toFixed(1), '26.7');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '5.13');
});

test('a link leaving the data area is still NO-GO', () => {
  const { m, level } = open(OFF_MAP_LINK);
  assert.equal(level, 'nogo');
  assert.ok(m.leavesCoverage);
});

test('reading an old link and writing it back gives the same link', () => {
  for (const link of [DEMO_LINK, NOGO_LINK]) assert.equal(`#${encodeState(decodeState(link, known))}`, link);
});

test('Standard is still the default settings', () => {
  assert.deepEqual(presetSettings('standard'), { ...DEFAULT_SETTINGS });
});
