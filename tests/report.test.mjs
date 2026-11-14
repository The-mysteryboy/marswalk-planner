import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, decideVerdict, formatDuration, legTable, measureRoute, steepSections,
  stopsNearRoute, walkingSpeedKmh,
} from '../js/report.js';
import { MARS_RADIUS_M } from '../js/route.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b} +/- ${tol}`);
const S = { ...DEFAULT_SETTINGS };

// Metres per degree of latitude: 2 pi R / 360 = 59,157.92 m.
const M_PER_DEG = (2 * Math.PI * MARS_RADIUS_M) / 360;
const north = (m) => ({ lat: 18 + m / M_PER_DEG, lon: 77 });
const HOME = north(0);

// Stand-in terrain with an exact grade in the northward direction.
const planar = (grade) => ({ elevationAt: (lat) => (lat - 18) * M_PER_DEG * grade });
const FLAT = planar(0);

test('speed: flat ground equals the base speed', () => {
  close(walkingSpeedKmh(0, 3.5), 3.5, 1e-12);
});

test('speed: a -0.1 grade matches flat, because |-0.1 + 0.05| = |0 + 0.05|', () => {
  close(walkingSpeedKmh(-0.1, 3.5), 3.5, 1e-12);
});

test('speed: peak is at -0.05, by hand 3.5 x exp(0.175) = 4.169', () => {
  close(walkingSpeedKmh(-0.05, 3.5), 4.169, 0.001);
});

test('speed: uphill 0.1 grade, by hand 3.5 x exp(-0.35) = 2.466', () => {
  close(walkingSpeedKmh(0.1, 3.5), 2.466, 0.001);
});

test('flat 3.5 km route: 1 h each way, by hand', () => {
  const m = measureRoute([HOME, north(3500)], HOME, FLAT, S);
  close(m.distanceM, 3500, 0.01);
  close(m.outH, 1, 1e-6);
  close(m.backH, 1, 1e-6);
  close(m.walkH, 2, 1e-6);
  close(m.evaUsedH, 3, 1e-6, 'walking 2 h plus 60 min science');
  close(m.marginPct, 62.5, 1e-4, '1 - 3/8');
  assert.equal(m.maxSlopeDeg, 0);
  assert.equal(m.ascentM, 0);
});

test('uphill route: the way back is timed on the reversed grade, not doubled', () => {
  const m = measureRoute([HOME, north(3500)], HOME, planar(0.1), S);
  close(m.outH, 3.5 / 2.4664, 0.001, 'out at 2.466 km/h');
  close(m.backH, 1, 1e-6, 'back down at 3.5 km/h, see the -0.1 grade test');
  assert.ok(m.walkH < m.outH * 2, 'simple doubling would overstate this route');
});

test('downhill route: simple doubling would understate it, this does not', () => {
  const m = measureRoute([HOME, north(3500)], HOME, planar(-0.1), S);
  close(m.outH, 1, 1e-6);
  close(m.backH, 3.5 / 2.4664, 0.001);
  assert.ok(m.walkH > m.outH * 2);
});

test('slope and climb: 10% grade over 1 km is 5.71 deg and 100 m', () => {
  const m = measureRoute([HOME, north(1000)], HOME, planar(0.1), S);
  close(m.maxSlopeDeg, 5.711, 0.001);
  close(m.ascentM, 100, 0.01);
  assert.equal(m.descentM, 0);
});

test('abort distance: peak is at the far end of an out-and-back', () => {
  const m = measureRoute([HOME, north(1000), HOME], HOME, FLAT, S);
  close(m.distanceM, 2000, 0.01);
  close(m.abort.maxM, 1000, 0.01);
  close(m.abort.atM, 1000, 0.01);
});

test('abort distance: is straight-line, so a dogleg peaks below its path length', () => {
  const corner = north(3000);
  const east = { lat: corner.lat, lon: corner.lon + 0.0507 };
  const m = measureRoute([HOME, corner, east], HOME, FLAT, S);
  assert.ok(m.abort.maxM < m.distanceM);
  close(m.abort.maxM, Math.hypot(3000, m.distanceM - 3000), 15, 'right triangle');
});

test('coverage: a route that runs off the grid is flagged and measured', () => {
  const edge = { elevationAt: (lat) => (lat < north(1000).lat ? 0 : null) };
  const m = measureRoute([HOME, north(2000)], HOME, edge, S);
  assert.equal(m.leavesCoverage, true);
  assert.ok(m.uncoveredM >= 950 && m.uncoveredM <= 1100, `uncovered ${m.uncoveredM}`);
  close(m.walkH, (2 * 2) / 3.5, 1e-6, 'uncovered ground still costs time');
});

test('coverage: a fully covered route is not flagged', () => {
  assert.equal(measureRoute([HOME, north(1000)], HOME, FLAT, S).leavesCoverage, false);
});

test('steep sections: only over the caution limit, rated by severity', () => {
  const samples = [
    { d: 0, slopeDeg: null }, { d: 50, slopeDeg: 5 }, { d: 100, slopeDeg: 16 },
    { d: 150, slopeDeg: 20 }, { d: 200, slopeDeg: 5 }, { d: 250, slopeDeg: 30 }, { d: 300, slopeDeg: 2 },
  ];
  assert.deepEqual(steepSections(samples, S), [
    { fromM: 50, toM: 150, maxDeg: 20, severity: 'caution' },
    { fromM: 200, toM: 250, maxDeg: 30, severity: 'nogo' },
  ]);
});

const metrics = (over) => ({
  maxSlopeDeg: 5, maxSlopeAtM: 100, evaUsedH: 4, marginPct: 50, leavesCoverage: false, uncoveredM: 0, ...over,
});
const levels = (v) => v.reasons.map((r) => r.level);

test('verdict: GO, and still lists its reasons', () => {
  const v = decideVerdict(metrics(), S);
  assert.equal(v.level, 'go');
  assert.equal(v.reasons.length, 3);
});

test('verdict: slope exactly at 15 stays GO, just over is CAUTION', () => {
  assert.equal(decideVerdict(metrics({ maxSlopeDeg: 15 }), S).level, 'go');
  assert.equal(decideVerdict(metrics({ maxSlopeDeg: 15.01 }), S).level, 'caution');
});

test('verdict: slope exactly at 25 stays CAUTION, just over is NO-GO', () => {
  assert.equal(decideVerdict(metrics({ maxSlopeDeg: 25 }), S).level, 'caution');
  assert.equal(decideVerdict(metrics({ maxSlopeDeg: 25.01 }), S).level, 'nogo');
});

test('verdict: margin exactly 25% stays GO, under is CAUTION', () => {
  assert.equal(decideVerdict(metrics({ evaUsedH: 6, marginPct: 25 }), S).level, 'go');
  assert.equal(decideVerdict(metrics({ evaUsedH: 6.1, marginPct: 23.75 }), S).level, 'caution');
});

test('verdict: exactly using the budget is CAUTION, over it is NO-GO', () => {
  assert.equal(decideVerdict(metrics({ evaUsedH: 8, marginPct: 0 }), S).level, 'caution');
  assert.equal(decideVerdict(metrics({ evaUsedH: 8.5, marginPct: -6.25 }), S).level, 'nogo');
});

test('verdict: leaving coverage is NO-GO even when all else is fine', () => {
  const v = decideVerdict(metrics({ leavesCoverage: true, uncoveredM: 1200 }), S);
  assert.equal(v.level, 'nogo');
  assert.match(v.reasons[0].text, /1\.20 km/);
});

test('verdict: several problems are all reported, worst level wins', () => {
  const v = decideVerdict(metrics({ maxSlopeDeg: 40, evaUsedH: 12, marginPct: -50, leavesCoverage: true, uncoveredM: 50 }), S);
  assert.equal(v.level, 'nogo');
  assert.deepEqual(levels(v), ['nogo', 'nogo', 'nogo']);
});

test('verdict: a slope problem and a tight budget both show as cautions', () => {
  const v = decideVerdict(metrics({ maxSlopeDeg: 20, evaUsedH: 7, marginPct: 12.5 }), S);
  assert.deepEqual(levels(v), ['caution', 'caution']);
});

test('verdict: thresholds follow the settings', () => {
  assert.equal(decideVerdict(metrics({ maxSlopeDeg: 12 }), { ...S, cautionSlopeDeg: 10 }).level, 'caution');
});

test('stops: within the radius, nearest first, with distance along the route', () => {
  const samples = measureRoute([HOME, north(5000)], HOME, FLAT, S).samples;
  const near = { id: 'near', ...north(2000), lon: 77 + 0.01 };
  const nearer = { id: 'nearer', ...north(4000), lon: 77 + 0.002 };
  const far = { id: 'far', ...north(2000), lon: 77 + 1 };
  const out = stopsNearRoute([near, far, nearer], samples, 2);
  assert.deepEqual(out.map((s) => s.id), ['nearer', 'near']);
  close(out[1].alongM, 2000, 26, 'nearest sample is within half a step');
  close(out[1].distanceM, 0.01 * M_PER_DEG * Math.cos(18.034 * (Math.PI / 180)), 3);
});

test('stops: an empty route has none', () => {
  assert.deepEqual(stopsNearRoute([{ id: 'x', lat: 18, lon: 77 }], [], 2), []);
});

test('legs: split at each vertex, with lengths that add up', () => {
  const pts = [HOME, north(1000), north(1800)];
  const m = measureRoute(pts, HOME, planar(0.1), S);
  const legs = legTable(m.samples, pts);
  assert.equal(legs.length, 2);
  close(legs[0].lengthM, 1000, 0.01);
  close(legs[1].lengthM, 800, 0.01);
  close(legs[1].endZ, 180, 0.01);
  close(legs[0].maxSlopeDeg, 5.711, 0.001);
});

test('legs: a repeated point becomes a zero-length leg and later legs stay right', () => {
  const pts = [HOME, north(1000), north(1000), north(1800)];
  const m = measureRoute(pts, HOME, FLAT, S);
  const legs = legTable(m.samples, pts);
  assert.deepEqual(legs.map((l) => Math.round(l.lengthM)), [1000, 0, 800]);
});

test('steep sections: flag No-Go ground even if caution is set above the No-Go limit', () => {
  const samples = [{ d: 0, slopeDeg: null }, { d: 50, slopeDeg: 28 }];
  const out = steepSections(samples, { ...S, cautionSlopeDeg: 40, maxSlopeDeg: 25 });
  assert.equal(out[0].severity, 'nogo');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0.5), '30 min');
  assert.equal(formatDuration(1), '1 h 00 min');
  assert.equal(formatDuration(3.25), '3 h 15 min');
  assert.equal(formatDuration(1.9999), '2 h 00 min');
});
