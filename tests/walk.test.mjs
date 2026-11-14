// Play the walk replays the report, so its last frame must be the report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS, decideVerdict, formatDuration, measureRoute, steepSections,
} from '../js/report.js';
import { MINUTES_PER_SECOND, buildWalk, frameAt, frameText } from '../js/walk.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
const OFF_MAP = [HOME, { lat: 18.45865, lon: 77.40592 }, { lat: 19.05, lon: 77.4 }];

function report(points, settings = { ...DEFAULT_SETTINGS }, status = 'final') {
  const m = measureRoute(points, HOME, terrain, settings);
  return { m, verdict: decideVerdict(m, settings), sections: steepSections(m.samples, settings), settings, status };
}

const finish = (points) => {
  const r = report(points);
  const walk = buildWalk(r);
  const frame = frameAt(walk, walk.totalH);
  return { r, frame, text: frameText(walk, frame) };
};

test('demo route: the final frame is the report, 4.83 km, CAUTION, 18.1° at 4.44 km', () => {
  const { r, frame, text } = finish(DEMO);
  assert.equal(frame.phase, 'done');
  assert.equal(frame.coveredM, r.m.distanceM);
  assert.equal(frame.timeH, r.m.evaUsedH);
  assert.equal(frame.steepest.deg, r.m.maxSlopeDeg);
  assert.equal(frame.steepest.atM, r.m.maxSlopeAtM);
  assert.equal(text.distance, '4.83 km each way');
  assert.equal(text.steepest, '18.1° at 4.44 km');
  assert.equal(text.time, formatDuration(r.m.evaUsedH));
  assert.equal(text.time, '4 h 02 min');
  assert.equal(text.status, 'Back at base after 4 h 02 min. CAUTION: steepest slope 18.1° at 4.44 km.');
});

test('NO-GO link: the final frame is the report, NO-GO, 26.7° at 5.13 km', () => {
  const { r, frame, text } = finish(SCARP);
  assert.equal(r.verdict.level, 'nogo');
  assert.equal(frame.steepest.deg, r.m.maxSlopeDeg);
  assert.equal(frame.timeH, r.m.evaUsedH);
  assert.equal(text.distance, '5.43 km each way');
  assert.equal(text.steepest, '26.7° at 5.13 km');
  assert.equal(text.time, '4 h 37 min');
  assert.equal(text.status, 'Back at base after 4 h 37 min. NO-GO: steepest slope 26.7° at 5.13 km.');
});

test('it never runs from a preview or a failed grid', () => {
  for (const status of ['preview', 'refining', 'failed']) assert.equal(buildWalk(report(DEMO, { ...DEFAULT_SETTINGS }, status)), null);
  assert.equal(buildWalk(null), null);
  assert.equal(buildWalk(undefined), null);
});

test('the running times on the samples end on the report totals', () => {
  const { m } = report(DEMO);
  const last = m.samples.at(-1);
  assert.equal(last.outH, m.outH);
  assert.equal(last.backH, m.backH);
  assert.equal(m.samples[0].outH, 0);
  assert.equal(m.samples[0].backH, 0);
  for (let i = 1; i < m.samples.length; i++) {
    assert.ok(m.samples[i].outH > m.samples[i - 1].outH && m.samples[i].backH > m.samples[i - 1].backH);
  }
});

test('it goes out, stays for the science time, and comes back', () => {
  const walk = buildWalk(report(DEMO));
  const { m, scienceH } = walk;
  const at = (h) => frameAt(walk, h);

  assert.equal(at(0).phase, 'out');
  assert.equal(at(0).d, 0);
  assert.equal(at(m.outH / 2).phase, 'out');
  assert.ok(at(m.outH / 2).d > 0 && at(m.outH / 2).d < m.distanceM);

  const hold = at(m.outH + scienceH / 2);
  assert.equal(hold.phase, 'science');
  assert.equal(hold.d, m.distanceM);
  assert.equal(hold.index, m.samples.length - 1);

  const back = at(m.outH + scienceH + m.backH / 2);
  assert.equal(back.phase, 'back');
  assert.ok(back.d > 0 && back.d < m.distanceM);
  assert.ok(Math.abs(back.coveredM + back.d - m.distanceM) < 1e-6, 'covered counts from the far end');

  assert.equal(at(walk.totalH).phase, 'done');
  assert.equal(at(walk.totalH).d, 0);
  assert.equal(at(walk.totalH + 5).timeH, walk.totalH, 'it cannot run past the end');
  assert.equal(at(-1).timeH, 0);
});

test('the marker keeps to each sample at the time the report reaches it', () => {
  const walk = buildWalk(report(DEMO));
  const { samples } = walk.m;
  for (const i of [1, 10, 40, samples.length - 2]) {
    const s = samples[i];
    const frame = frameAt(walk, s.outH);
    assert.ok(Math.abs(frame.d - s.d) < 1e-6, `sample ${i}`);
    assert.equal(frame.elevationM, s.z);
    assert.equal(frame.slopeDeg, s.slopeDeg);
    const back = frameAt(walk, walk.m.outH + walk.scienceH + (walk.m.backH - s.backH));
    assert.ok(Math.abs(back.d - s.d) < 1e-6, `sample ${i} on the way back`);
    assert.equal(back.elevationM, s.z);
  }
});

test('every number moves the right way through the whole walk', () => {
  const walk = buildWalk(report(SCARP));
  let before = frameAt(walk, 0);
  for (let h = 0; h <= walk.totalH; h += walk.totalH / 500) {
    const frame = frameAt(walk, h);
    assert.ok(frame.timeH >= before.timeH);
    assert.ok(frame.steepest.deg >= before.steepest.deg);
    if (frame.phase === 'out') assert.ok(frame.d >= before.d);
    if (frame.phase === 'back' && before.phase === 'back') assert.ok(frame.d <= before.d);
    before = frame;
  }
});

test('steepest so far reads the report slope only once the walker has reached it', () => {
  const walk = buildWalk(report(DEMO));
  const { samples } = walk.m;
  const i = samples.findIndex((s) => s.d === walk.m.maxSlopeAtM);
  assert.ok(frameAt(walk, samples[i - 1].outH).steepest.deg < walk.m.maxSlopeDeg);
  const onIt = (samples[i - 1].outH + samples[i].outH) / 2;
  assert.equal(frameAt(walk, onIt).steepest.deg, walk.m.maxSlopeDeg);
});

test('slope here is never above steepest so far', () => {
  for (const points of [DEMO, SCARP]) {
    const walk = buildWalk(report(points));
    for (let h = 0; h <= walk.m.outH; h += walk.m.outH / 2000) {
      const frame = frameAt(walk, h);
      if (frame.slopeDeg !== null && frame.phase === 'out') assert.ok(frame.slopeDeg <= frame.steepest.deg, `at ${h}`);
    }
  }
});

test('a steep section lights when the walker enters it, on both legs', () => {
  const walk = buildWalk(report(SCARP));
  const { samples } = walk.m;
  const worst = walk.sections.findIndex((s) => s.severity === 'nogo');
  const section = walk.sections[worst];
  assert.ok(worst >= 0);
  const entry = samples.findIndex((s) => s.d === section.fromM);
  assert.equal(frameAt(walk, samples[entry].outH).section, worst);
  assert.notEqual(frameAt(walk, samples[entry - 1].outH).section, worst);

  const inside = frameAt(walk, samples[entry + 1].outH);
  assert.ok(frameText(walk, inside).status.includes('Steep section, over our assumed limit of 25°.'));
  const onReturn = frameAt(walk, walk.m.outH + walk.scienceH + (walk.m.backH - samples[entry + 1].backH));
  assert.equal(onReturn.section, worst);
  assert.equal(frameAt(walk, walk.totalH).section, -1);
});

test('the science time says it is placed by the replay, and carries the assumption label', () => {
  const walk = buildWalk(report(DEMO));
  const text = frameText(walk, frameAt(walk, walk.m.outH + walk.scienceH / 2));
  assert.ok(text.status.startsWith('Science time, 1 h 00 min. ASSUMPTION:'));
});

test('with no science time it turns straight round', () => {
  const walk = buildWalk(report(DEMO, { ...DEFAULT_SETTINGS, scienceMinutes: 0 }));
  assert.equal(walk.totalH, walk.m.walkH);
  assert.equal(frameAt(walk, walk.m.outH + walk.m.backH / 2).phase, 'back');
  assert.equal(frameAt(walk, walk.totalH).timeH, walk.m.evaUsedH);
});

test('a route off the elevation data says no data, and still ends on the report total', () => {
  const r = report(OFF_MAP, { ...DEFAULT_SETTINGS, evaHours: 24, baseSpeedKmh: 10 });
  assert.ok(r.m.leavesCoverage);
  const walk = buildWalk(r);
  const { samples } = r.m;
  const gap = samples.findIndex((s) => s.z === null);
  const text = frameText(walk, frameAt(walk, samples[gap + 1].outH));
  assert.equal(text.elevation, 'no data');
  assert.equal(text.slope, 'no data');
  const end = frameAt(walk, walk.totalH);
  assert.equal(end.timeH, r.m.evaUsedH);
  assert.ok(frameText(walk, end).status.includes('NO-GO'));
});

test('replaying changes nothing in the report', () => {
  const r = report(SCARP);
  const before = JSON.stringify(r);
  const walk = buildWalk(r);
  for (let h = 0; h <= walk.totalH; h += walk.totalH / 50) frameText(walk, frameAt(walk, h));
  assert.equal(JSON.stringify(r), before);
});

test('1x shows the demo walk in about a minute, and 16x in about four seconds', () => {
  const walk = buildWalk(report(DEMO));
  const seconds = (speed) => (walk.totalH * 60) / (MINUTES_PER_SECOND * speed);
  assert.ok(seconds(1) > 50 && seconds(1) < 70, `${seconds(1)} s`);
  assert.ok(seconds(16) < 5);
});
