import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState, encodeState } from '../js/hash.js';

const KNOWN = { baseIds: ['ctx', 'mola'], overlayIds: ['rover', 'stops', 'hirise'] };
const PLAN = {
  habitat: { lat: 18.444627, lon: 77.450886 },
  waypoints: [{ lat: 18.4131, lon: 77.4237 }, { lat: 18.3553, lon: 77.3928 }],
  baseId: 'mola',
  overlays: new Set(['rover', 'hirise']),
};

test('round trip keeps the plan', () => {
  const back = decodeState(`#${encodeState(PLAN)}`, KNOWN);
  assert.ok(Math.abs(back.habitat.lat - PLAN.habitat.lat) < 1e-5);
  assert.ok(Math.abs(back.habitat.lon - PLAN.habitat.lon) < 1e-5);
  assert.deepEqual(back.waypoints, PLAN.waypoints);
  assert.equal(back.baseId, 'mola');
  assert.deepEqual([...back.overlays], ['rover', 'hirise']);
});

test('an empty hash means no shared plan', () => {
  assert.equal(decodeState('', KNOWN), null);
  assert.equal(decodeState('#', KNOWN), null);
});

test('no waypoints and all overlays off both survive', () => {
  const back = decodeState(`#${encodeState({ ...PLAN, waypoints: [], overlays: new Set() })}`, KNOWN);
  assert.deepEqual(back.waypoints, []);
  assert.deepEqual([...back.overlays], []);
});

test('a missing overlay field is not the same as an empty one', () => {
  assert.equal(decodeState('#b=ctx', KNOWN).overlays, null);
});

test('bad input is dropped, good input around it is kept', () => {
  const back = decodeState('#h=abc,def&w=18,77;999,0;18.5;;19,78&b=nope&o=rover,evil', KNOWN);
  assert.equal(back.habitat, null);
  assert.deepEqual(back.waypoints, [{ lat: 18, lon: 77 }, { lat: 19, lon: 78 }]);
  assert.equal(back.baseId, null);
  assert.deepEqual([...back.overlays], ['rover']);
});

test('script-like text cannot reach the app as a layer id', () => {
  const back = decodeState('#b=<img src=x onerror=alert(1)>&o=<script>', KNOWN);
  assert.equal(back.baseId, null);
  assert.deepEqual([...back.overlays], []);
});

test('a huge link is capped', () => {
  const many = Array.from({ length: 500 }, (_, i) => `18,${i % 100}`).join(';');
  assert.equal(decodeState(`#w=${many}`, KNOWN).waypoints.length, 200);
});
