// The turn-back point, checked against a calculation written separately from the app's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS, decideVerdict, formatDuration, measureRoute, steepSections, turnBackPoint, turnBackText,
  walkingSpeedKmh,
} from '../js/report.js';
import { samplePath } from '../js/route.js';
import { buildWalk, frameAt, frameText } from '../js/walk.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const HOME = { lat: 18.44463, lon: 77.45089 };
const STOPS = [{ lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const DEMO = [HOME, ...STOPS];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
// There and back along the demo, then out again, so it is too long for the 8 h budget.
const LONG = [...DEMO, ...[...STOPS].reverse().slice(1), HOME, ...STOPS];
const OFF_MAP = [HOME, { lat: 18.45865, lon: 77.40592 }, { lat: 19.05, lon: 77.4 }];
const STANDARD = { ...DEFAULT_SETTINGS };

const measure = (points, settings = STANDARD) => measureRoute(points, HOME, terrain, settings);

// Tobler's formula typed out again, and a walk along the route, sharing nothing with the
// report's running times. It returns the last sample that fits, or -1 for the whole route.
function independent(points, settings) {
  const speed = (grade) => (settings.baseSpeedKmh * Math.exp(-3.5 * Math.abs(grade + 0.05))) / Math.exp(-3.5 * 0.05);
  const path = samplePath(points, settings.sampleStepM).map((s) => ({ d: s.d, z: terrain.elevationAt(s.lat, s.lon) }));
  const science = settings.scienceMinutes / 60;
  let out = 0;
  let back = 0;
  let lastFit = 0;
  for (let i = 1; i < path.length; i++) {
    const run = path[i].d - path[i - 1].d;
    const grade = (path[i].z - path[i - 1].z) / run;
    out += run / 1000 / speed(grade);
    back += run / 1000 / speed(-grade);
    if (out + back + science <= settings.evaHours) lastFit = i;
    else return { index: lastFit, atM: path[lastFit].d };
  }
  return { index: -1, atM: path.at(-1).d };
}

test('a route that fits: the app and the separate calculation agree, with the time to spare', () => {
  const m = measure(DEMO);
  const point = turnBackPoint(m, STANDARD);
  assert.equal(independent(DEMO, STANDARD).index, -1);
  assert.equal(point.kind, 'fits');
  assert.equal(point.spareH, 8 - m.evaUsedH);
  assert.equal(turnBackText(point, m, STANDARD), 'The whole round trip fits: 4 h 02 min of our assumed 8 h limit, with 3 h 58 min to spare.');
});

test('a route that does not fit: the app and the separate calculation agree', () => {
  const m = measure(LONG);
  const point = turnBackPoint(m, STANDARD);
  assert.ok(m.evaUsedH > 8);
  assert.equal(point.kind, 'turn');
  const other = independent(LONG, STANDARD);
  assert.equal(point.index, other.index);
  assert.equal(point.atM, other.atM);
  assert.equal(m.samples[point.index].d, point.atM);
});

test('the same route gets a different point under a shorter budget, and still agrees', () => {
  for (const evaHours of [2, 3, 4]) {
    const settings = { ...STANDARD, evaHours };
    const point = turnBackPoint(measure(SCARP, settings), settings);
    assert.equal(point.kind, 'turn');
    assert.equal(point.index, independent(SCARP, settings).index, `${evaHours} h`);
  }
});

test('a route that fails on the first segment says so', () => {
  const settings = { ...STANDARD, evaHours: 1 };
  const m = measure(DEMO, settings);
  const point = turnBackPoint(m, settings);
  assert.equal(independent(DEMO, settings).index, 0);
  assert.equal(point.kind, 'none');
  assert.equal(point.firstM, m.samples[1].d);
  assert.ok(point.firstH > 1);
  assert.ok(turnBackText(point, m, settings).startsWith('Even the first 0.05 km does not fit:'));
});

test('science time over the budget also fails on the first segment', () => {
  const settings = { ...STANDARD, evaHours: 0.5 };
  assert.equal(turnBackPoint(measure(DEMO, settings), settings).kind, 'none');
});

test('at the turn-back point it fits, and the next sample does not', () => {
  for (const [points, settings] of [[LONG, STANDARD], [SCARP, { ...STANDARD, evaHours: 3 }], [DEMO, { ...STANDARD, evaHours: 2.5, scienceMinutes: 0 }]]) {
    const m = measure(points, settings);
    const point = turnBackPoint(m, settings);
    const used = (s) => s.outH + s.backH + settings.scienceMinutes / 60;
    assert.equal(point.kind, 'turn');
    assert.ok(used(m.samples[point.index]) <= settings.evaHours);
    assert.ok(used(m.samples[point.index + 1]) > settings.evaHours);
    assert.equal(point.usedH, used(m.samples[point.index]));
    assert.equal(point.nextH, used(m.samples[point.index + 1]));
  }
});

test('exactly at the budget fits, as it does in the verdict', () => {
  const m = measure(DEMO);
  const exact = { ...STANDARD, evaHours: m.evaUsedH };
  assert.equal(turnBackPoint(m, exact).kind, 'fits');
  assert.equal(turnBackPoint(m, exact).spareH, 0);
  const under = turnBackPoint(m, { ...STANDARD, evaHours: m.evaUsedH - 1e-9 });
  assert.equal(under.kind, 'turn');
  assert.equal(under.index, m.samples.length - 2);
});

test('it agrees with the verdict rule on every budget', () => {
  const m = measure(SCARP);
  for (let evaHours = 0.5; evaHours <= 24; evaHours += 0.5) {
    const settings = { ...STANDARD, evaHours };
    const over = decideVerdict(m, settings).reasons.some((r) => r.text.startsWith('Round trip plus science'));
    assert.equal(turnBackPoint(m, settings).kind !== 'fits', over, `${evaHours} h`);
  }
});

test('the text gives the numbers behind the point', () => {
  const m = measure(LONG);
  const point = turnBackPoint(m, STANDARD);
  const text = turnBackText(point, m, STANDARD);
  assert.ok(text.startsWith(`Turn back by ${(point.atM / 1000).toFixed(2)} km: ${formatDuration(point.outH)} out, 1 h 00 min of science and ${formatDuration(point.backH)} back make ${formatDuration(point.usedH)}, within our assumed 8 h limit.`), text);
  assert.ok(text.endsWith(`Going on to ${(point.nextM / 1000).toFixed(2)} km would take ${formatDuration(point.nextH)}.`), text);
});

test('a route off the elevation data says those stretches use the flat-ground speed', () => {
  const settings = { ...STANDARD, evaHours: 24 };
  const m = measure(OFF_MAP, settings);
  assert.ok(turnBackText(turnBackPoint(m, settings), m, settings).endsWith('Stretches with no elevation data use the flat-ground speed.'));
});

test('the demo and the NO-GO link keep exactly the numbers from before this change', () => {
  const demo = measure(DEMO);
  // Captured from commit 6a8b049, the build before the turn-back point.
  assert.equal(demo.distanceM, 4833.426031377117);
  assert.equal(demo.maxSlopeDeg, 18.089116038563834);
  assert.equal(demo.maxSlopeAtM, 4440.021061338655);
  assert.equal(demo.outH, 1.5461251901746504);
  assert.equal(demo.backH, 1.493863098340336);
  assert.equal(demo.evaUsedH, 4.039988288514986);
  assert.equal(demo.marginPct, 49.50014639356267);
  assert.equal(decideVerdict(demo, STANDARD).level, 'caution');

  const scarp = measure(SCARP);
  assert.equal(scarp.distanceM, 5430.651914466528);
  assert.equal(scarp.maxSlopeDeg, 26.705066360996344);
  assert.equal(scarp.maxSlopeAtM, 5132.038972921822);
  assert.equal(scarp.outH, 1.8827857115815623);
  assert.equal(scarp.backH, 1.7401951876239543);
  assert.equal(scarp.evaUsedH, 4.622980899205516);
  assert.equal(decideVerdict(scarp, STANDARD).level, 'nogo');
});

// Play the walk ------------------------------------------------------------------
const report = (points, settings = STANDARD) => {
  const m = measure(points, settings);
  return { m, verdict: decideVerdict(m, settings), sections: steepSections(m.samples, settings), settings, status: 'final' };
};

test('a walk that fits plays exactly as it did: all the way out, and home', () => {
  const walk = buildWalk(report(DEMO));
  assert.equal(walk.farM, walk.m.distanceM);
  assert.equal(walk.totalH, walk.m.evaUsedH);
  const hold = frameText(walk, frameAt(walk, walk.outH + walk.scienceH / 2));
  assert.ok(hold.status.startsWith('Science time, 1 h 00 min. ASSUMPTION: the replay puts it at the far end.'));
});

test('a walk that does not fit turns at the point, shows the message, and comes home', () => {
  const r = report(LONG);
  const walk = buildWalk(r);
  const point = turnBackPoint(r.m, STANDARD);
  assert.equal(walk.farM, point.atM);
  assert.equal(walk.totalH, point.usedH);
  assert.ok(walk.totalH <= STANDARD.evaHours);

  assert.ok(frameAt(walk, point.outH * 0.99).d < point.atM);
  const turning = frameAt(walk, point.outH);
  assert.equal(turning.d, point.atM);
  assert.equal(turning.speedKmh, 0);
  const text = frameText(walk, turning);
  assert.ok(text.status.startsWith('Turn back here: staying longer would use more than the assumed time.'), text.status);
  assert.equal(text.speed, 'Stopped');

  const home = frameAt(walk, point.outH + walk.scienceH + point.backH / 2);
  assert.equal(home.phase, 'back');
  assert.ok(home.d > 0 && home.d < point.atM);
});

test('its final frame gives the walk it made and the report totals for the whole route', () => {
  const r = report(LONG);
  const walk = buildWalk(r);
  const point = turnBackPoint(r.m, STANDARD);
  const end = frameAt(walk, walk.totalH);
  const text = frameText(walk, end);
  assert.equal(end.phase, 'done');
  assert.equal(end.d, 0);
  assert.equal(end.timeH, point.usedH);
  assert.equal(text.time, formatDuration(point.usedH));
  assert.equal(text.distance, `${(point.atM / 1000).toFixed(2)} km each way, turned back`);
  const whole = `The full route is ${(r.m.distanceM / 1000).toFixed(2)} km each way and would take ${formatDuration(r.m.evaUsedH)}. NO-GO: steepest slope ${r.m.maxSlopeDeg.toFixed(1)}° at ${(r.m.maxSlopeAtM / 1000).toFixed(2)} km.`;
  assert.ok(text.status.endsWith(whole), text.status);
  // The report itself is untouched by the shorter replay.
  assert.equal(r.m.evaUsedH, measure(LONG).evaUsedH);
});

test('a walk that cannot start stays at base and says why', () => {
  const settings = { ...STANDARD, evaHours: 1 };
  const walk = buildWalk(report(DEMO, settings));
  const end = frameAt(walk, 0);
  assert.equal(end.phase, 'done');
  assert.equal(end.d, 0);
  const text = frameText(walk, end);
  assert.equal(text.distance, 'Stayed at base');
  assert.ok(text.status.startsWith('This walk cannot start: even the first 0.05 km does not fit the assumed time.'));
  assert.ok(text.status.endsWith('NO-GO: steepest slope 18.1° at 4.44 km.'), text.status);
});

test('live speed is the time model on every step, both ways, and zero when stopped', () => {
  const walk = buildWalk(report(SCARP));
  const { samples } = walk.m;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const grade = (b.z - a.z) / (b.d - a.d);
    const out = frameAt(walk, (a.outH + b.outH) / 2);
    assert.ok(Math.abs(out.speedKmh - walkingSpeedKmh(grade, 3.5)) < 1e-9, `out, step ${i}`);
    const backAt = walk.outH + walk.scienceH + (walk.backH - (a.backH + b.backH) / 2);
    assert.ok(Math.abs(frameAt(walk, backAt).speedKmh - walkingSpeedKmh(-grade, 3.5)) < 1e-9, `back, step ${i}`);
  }
  assert.equal(frameAt(walk, walk.outH + walk.scienceH / 2).speedKmh, 0);
  assert.equal(frameAt(walk, walk.totalH).speedKmh, 0);
});

test('the marker changes speed with slope, and differs out and back', () => {
  const walk = buildWalk(report(DEMO));
  const speeds = [];
  for (let h = 0; h < walk.outH; h += walk.outH / 400) speeds.push(frameAt(walk, h).speedKmh);
  assert.ok(Math.min(...speeds) < 2 && Math.max(...speeds) > 4, `${Math.min(...speeds)} to ${Math.max(...speeds)}`);
  assert.notEqual(walk.outH, walk.backH);
});
